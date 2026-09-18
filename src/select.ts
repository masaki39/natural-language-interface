import type { ChoiceCriteria } from "@typesafe-ai/sdk";
import type { Ask } from "./backend.ts";
import { expandGroup, type Command, type Group, type Spec } from "./spec.ts";

export const NONE = "none of these";

/** Jev accepts 255 options per Choice; one is kept for NONE. */
const MAX_OPTIONS = 254;
/** Rough size cap for one Choice's criteria, well inside the 32k-token state + question budget. */
const MAX_CHARS = 60_000;
/** Finalists each chunk sends to the final round when a list is split. */
const FINALISTS_PER_CHUNK = 3;

export type Ranked = { path: string; probability: number };

export type Selection = {
  /** Confidence of the last Choice made, the one that picked the command. */
  confidence: number;
  /** Commands (and NONE) by probability, highest first. */
  ranking: Ranked[];
  input_tokens: number;
  requests: number;
};

type Option = { key: string; description: string; command?: Command; group?: Group };

const ROOT = "(no subcommand)";

function instructions(tool: string) {
  return {
    task: `Pick the \`${tool}\` subcommand that performs what \`request\` asks for.`,
    notes: [
      "The request may be written in Japanese or English.",
      "Asking to see several items, or items filtered by a condition (merged, closed, labeled...), means a list or search command, not a view of one item.",
      "An option ending in … is a group; pick it when the right subcommand is inside it.",
    ],
  };
}

function criteriaFor(options: Option[], tool: string): ChoiceCriteria {
  const criteria: ChoiceCriteria = {};
  for (const o of options) criteria[o.key] = o.description;
  criteria[NONE] = `No ${tool} subcommand performs what the request asks for.`;
  return criteria;
}

const size = (options: Option[]) => options.reduce((n, o) => n + o.key.length + o.description.length + 8, 0);

function chunk(options: Option[]): Option[][] {
  const chunks: Option[][] = [[]];
  for (const o of options) {
    const last = chunks.at(-1)!;
    if (last.length >= MAX_OPTIONS || size([...last, o]) > MAX_CHARS) chunks.push([o]);
    else last.push(o);
  }
  return chunks;
}

type Choice = { probabilities: Record<string, number>; confidence: number; input_tokens: number; requests: number };

/**
 * One Choice over any number of options. Lists over the per-question limits are split into
 * chunks asked in parallel, and the chunk winners meet in a final round.
 */
async function choose(ask: Ask, request: string, tool: string, options: Option[]): Promise<Choice> {
  const chunks = chunk(options);
  if (chunks.length === 1) {
    const reply = await ask({ request }, { command: { type: "choice", instructions: instructions(tool), criteria: criteriaFor(options, tool) } });
    const answer = reply.answers.command!;
    return { probabilities: answer.probabilities!, confidence: answer.confidence!, input_tokens: reply.usage.input_tokens, requests: 1 };
  }
  const replies = await Promise.all(
    chunks.map((c) => ask({ request }, { command: { type: "choice", instructions: instructions(tool), criteria: criteriaFor(c, tool) } })),
  );
  const finalists = new Set<string>();
  for (const r of replies) {
    Object.entries(r.answers.command!.probabilities!)
      .filter(([k]) => k !== NONE)
      .sort((a, b) => b[1] - a[1])
      .slice(0, FINALISTS_PER_CHUNK)
      .forEach(([k]) => finalists.add(k));
  }
  const final = await choose(ask, request, tool, options.filter((o) => finalists.has(o.key)));
  return {
    ...final,
    input_tokens: final.input_tokens + replies.reduce((n, r) => n + r.usage.input_tokens, 0),
    requests: final.requests + replies.length,
  };
}

const depth = (path: string) => (path === "" ? 0 : path.split(" ").length);
const isChild = (path: string, parent: string) => depth(path) === depth(parent) + 1 && (parent === "" || path.startsWith(`${parent} `));

function commandOption(c: Command): Option {
  return { key: c.path || ROOT, description: `${c.summary} (usage: ${c.usage})`, command: c };
}

function groupOption(spec: Spec, g: Group): Option {
  const children = [...spec.commands, ...spec.groups].filter((x) => isChild(x.path, g.path)).map((x) => x.path.split(" ").at(-1));
  const sample = [...new Set(children)].slice(0, 12).join(", ");
  return { key: `${g.path} …`, description: [g.summary, sample && `subcommands: ${sample}`].filter(Boolean).join(" — "), group: g };
}

function toRanking(options: Option[], choice: Choice): Ranked[] {
  const byKey = new Map(options.map((o) => [o.key, o]));
  return Object.entries(choice.probabilities)
    .map(([key, probability]) => ({ key, probability }))
    .filter(({ key }) => key === NONE || byKey.get(key)?.command)
    .map(({ key, probability }) => ({ path: key === NONE ? NONE : byKey.get(key)!.command!.path, probability }))
    .sort((a, b) => b.probability - a.probability);
}

const under = (path: string, prefix: string) => prefix === "" || path === prefix || path.startsWith(`${prefix} `);

/**
 * The options offered below `prefix`: every command under it when they fit in one Choice (one
 * round trip for gh, git, docker...), otherwise only its direct children, walked level by level
 * (aws). Groups whose subcommands haven't been fetched yet are offered either way.
 */
function levelOptions(spec: Spec, prefix: string): Option[] {
  const all = spec.commands.filter((c) => under(c.path, prefix)).map(commandOption);
  const lazy = spec.groups.filter((g) => g.load && g.path !== prefix && under(g.path, prefix)).map((g) => groupOption(spec, g));
  if (all.length + lazy.length <= MAX_OPTIONS && size([...all, ...lazy]) <= MAX_CHARS) return [...all, ...lazy];
  return [
    ...spec.commands.filter((c) => c.path === prefix && prefix !== "").map(commandOption),
    ...spec.commands.filter((c) => isChild(c.path, prefix)).map(commandOption),
    ...spec.groups.filter((g) => isChild(g.path, prefix)).map((g) => groupOption(spec, g)),
  ];
}

/** Pick the command, descending into groups (and fetching lazy ones) until a command wins. */
export async function selectCommand(ask: Ask, spec: Spec, request: string): Promise<Selection> {
  if (spec.commands.length === 1 && spec.groups.length === 0) {
    return { confidence: 1, ranking: [{ path: spec.commands[0]!.path, probability: 1 }], input_tokens: 0, requests: 0 };
  }
  let prefix = "";
  let tokens = 0;
  let requests = 0;
  for (;;) {
    const options = levelOptions(spec, prefix);
    if (options.length === 0) throw new Error(`no subcommands found under "${prefix}"`);
    const choice = await choose(ask, request, spec.tool, options);
    tokens += choice.input_tokens;
    requests += choice.requests;
    const top = Object.entries(choice.probabilities).sort((a, b) => b[1] - a[1])[0]![0];
    const group = options.find((o) => o.key === top)?.group;
    if (!group) {
      return { confidence: choice.confidence, ranking: toRanking(options, choice), input_tokens: tokens, requests };
    }
    await expandGroup(spec, group);
    prefix = group.path;
  }
}
