import type { ChoiceCriteria, Questions } from "@typesafe-ai/sdk";
import type { Ask, Reply } from "./backend.ts";
import { extractCandidates } from "./candidates.ts";
import type { Command, Spec } from "./spec.ts";

export const NONE = "none of these";
const UNSET = "not specified";

/** Flags that take structured syntax (jq, Go templates, field lists) no request will spell out. */
const SKIPPED_FLAGS = new Set(["jq", "template", "json", "help"]);

/** Noul probability above which a boolean flag is added; 0.5 let through borderline guesses like `auth login --web`. */
const FLAG_THRESHOLD = 0.6;

/** Probability a value or enum choice needs before it is added; weaker picks are usually guesses. */
const VALUE_THRESHOLD = 0.6;

export type Ranked = { path: string; probability: number };

export type Slot = {
  /** `--long` for flags, `<name>` for positionals. */
  slot: string;
  value: string | true;
  probability: number;
  /** Whether the value is a verbatim span of the request (as opposed to a flag or enum value). */
  span: boolean;
};

export type Suggestion = {
  path: string;
  probability: number;
  line: string;
  slots: Slot[];
};

export type Result = {
  /** Confidence of the subcommand choice; the main signal for whether to trust the answer. */
  confidence: number;
  /** Subcommand distribution, highest first, with the none option included. */
  ranking: Ranked[];
  /** Fully assembled commands for the top candidates, highest first. */
  suggestions: Suggestion[];
  usage: { input_tokens: number; requests: number };
};

export function commandQuestion(spec: Spec): Questions {
  const criteria: ChoiceCriteria = {};
  for (const c of spec.commands) criteria[c.path] = `${c.summary} (usage: ${c.usage})`;
  criteria[NONE] = `No ${spec.tool} subcommand performs what the request asks for.`;
  return {
    command: {
      type: "choice",
      instructions: {
        task: `Pick the \`${spec.tool}\` subcommand that performs what \`request\` asks for.`,
        notes: [
          "The request may be written in Japanese or English.",
          "Asking to see several items, or items filtered by a condition (merged, closed, labeled...), means a list or search command, not a view of one item.",
        ],
      },
      criteria,
    },
  };
}

/** Questions that fill one command's flags and positionals, keyed `<prefix>:<slot>`. */
function slotQuestions(command: Command, prefix: string, candidates: string[], spanKeys: Set<string>): Questions {
  const questions: Questions = {};
  // A span that names the command itself ("issue" in "closed issues") is never an argument value.
  const commandWords = new Set(command.path.split(" "));
  const values = candidates.filter((c) => !commandWords.has(c.toLowerCase()));
  const spans = (key: string): ChoiceCriteria => {
    spanKeys.add(key);
    const criteria: ChoiceCriteria = {};
    for (const c of values) criteria[c] = null;
    criteria[UNSET] = "The request does not give this value.";
    return criteria;
  };
  for (const p of command.positionals) {
    if (values.length === 0) break;
    const key = `${prefix}:<${p.name}>`;
    questions[key] = {
      type: "choice",
      instructions: { question: "Which span of `request` is this argument?", command: command.usage, argument: `<${p.name}>` },
      criteria: spans(key),
    };
  }
  for (const f of command.flags) {
    if (SKIPPED_FLAGS.has(f.long)) continue;
    const key = `${prefix}:--${f.long}`;
    // Structured fields beat a single sentence here: the flag's description is matched as a behavior.
    const option = { command: command.usage, option: `--${f.long}`, behavior: f.description };
    if (!f.valueType) {
      questions[key] = {
        type: "noul",
        instructions: { question: "Does `request` ask for the behavior of this option?", ...option },
      };
    } else if (f.enum) {
      const criteria: ChoiceCriteria = {};
      for (const v of f.enum) criteria[v] = null;
      criteria[UNSET] = "The request does not ask for a specific value.";
      questions[key] = {
        type: "choice",
        instructions: { question: "Which value of this option does `request` ask for?", ...option },
        criteria,
      };
    } else if (values.length > 0) {
      questions[key] = {
        type: "choice",
        instructions: { question: "Which span of `request` is the value of this option?", ...option },
        criteria: spans(key),
      };
    }
  }
  return questions;
}

function quote(value: string): string {
  return /^[A-Za-z0-9._/:@%+=,-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

function assemble(tool: string, command: Command, slots: Slot[]): string {
  const parts = [tool, command.path];
  for (const p of command.positionals) {
    const filled = slots.find((s) => s.slot === `<${p.name}>`);
    if (filled) parts.push(quote(String(filled.value)));
    else if (p.required) parts.push(`<${p.name}>`);
  }
  for (const s of slots) {
    if (!s.slot.startsWith("--")) continue;
    parts.push(s.value === true ? s.slot : `${s.slot} ${quote(s.value)}`);
  }
  return parts.join(" ");
}

/** Read one command's slots from the answers, giving each request span to at most one slot. */
function readSlots(answers: Reply["answers"], prefix: string, spanKeys: Set<string>): Slot[] {
  const slots: Slot[] = [];
  for (const [key, answer] of Object.entries(answers)) {
    if (!key.startsWith(`${prefix}:`)) continue;
    const slot = key.slice(prefix.length + 1);
    if (answer.type === "noul" && answer.noul! >= FLAG_THRESHOLD) {
      slots.push({ slot, value: true, probability: answer.noul!, span: false });
    } else if (answer.type === "choice" && answer.choice !== UNSET) {
      const probability = answer.probabilities![answer.choice!]!;
      if (probability < VALUE_THRESHOLD) continue;
      slots.push({ slot, value: answer.choice!, probability, span: spanKeys.has(key) });
    }
  }
  const claimed = new Map<string, Slot>();
  for (const s of slots) {
    if (!s.span) continue;
    const prev = claimed.get(String(s.value));
    if (!prev || prev.probability < s.probability) claimed.set(String(s.value), s);
  }
  return slots.filter((s) => !s.span || claimed.get(String(s.value)) === s);
}

export type SuggestOptions = {
  /** How many subcommands to fill in; the extra ones ride in the same request (speculative fan-out). */
  topK?: number;
  /** Only fill extra subcommands whose probability is at least this. */
  minAltProbability?: number;
};

export async function suggest(
  ask: Ask,
  spec: Spec,
  request: string,
  { topK = 3, minAltProbability = 0.05 }: SuggestOptions = {},
): Promise<Result> {
  const first = await ask({ request }, commandQuestion(spec));
  const answer = first.answers.command!;
  const ranking = Object.entries(answer.probabilities!)
    .map(([path, probability]) => ({ path, probability }))
    .sort((a, b) => b.probability - a.probability);

  const chosen = ranking
    .filter((r, i) => r.path !== NONE && (i === 0 || r.probability >= minAltProbability))
    .slice(0, topK)
    .map((r) => ({ ...r, command: spec.commands.find((c) => c.path === r.path)! }));

  const candidates = extractCandidates(request, spec.tool);
  const questions: Questions = {};
  const spanKeys = new Set<string>();
  chosen.forEach((c, i) => Object.assign(questions, slotQuestions(c.command, String(i), candidates, spanKeys)));

  let answers: Reply["answers"] = {};
  let inputTokens = first.usage.input_tokens;
  let requests = 1;
  if (Object.keys(questions).length > 0) {
    const second = await ask({ request, candidates }, questions);
    answers = second.answers;
    inputTokens += second.usage.input_tokens;
    requests++;
  }

  const suggestions = chosen.map((c, i) => {
    const slots = readSlots(answers, String(i), spanKeys);
    return { path: c.path, probability: c.probability, line: assemble(spec.tool, c.command, slots), slots };
  });
  return { confidence: answer.confidence!, ranking, suggestions, usage: { input_tokens: inputTokens, requests } };
}
