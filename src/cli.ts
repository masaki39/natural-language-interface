#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { createBackend, loadDotEnv } from "./backend.ts";
import { commandQuestion, NONE, suggest, type Result } from "./engine.ts";
import { loadSpec } from "./spec.ts";

/** Below this subcommand confidence, alternatives are shown next to the top answer. */
const SURE = 0.6;

const HELP = `usage: nli <tool> <request...> [options]

Suggest a command line for a natural-language request. Nothing is executed:
the command goes to stdout, explanations go to stderr.

  --pick      choose among the top candidates with fzf
  --explain   show probabilities, latency and token usage
  --dry-run   show the size of the first request without calling the API

environment: OPENROUTER_API_KEY or TYPESAFE_API_KEY (OpenRouter wins when both
are set; force one with NLI_BACKEND=openrouter|typesafe), NLI_MODEL

example: nli gh 'リポジトリ一覧を取得'`;

function explain(result: Result, ms: number) {
  const pct = (p: number) => `${(p * 100).toFixed(1).padStart(5)}%`;
  console.error(`subcommand confidence ${result.confidence.toFixed(2)}`);
  for (const r of result.ranking.slice(0, 5)) console.error(`  ${pct(r.probability)}  ${r.path}`);
  for (const s of result.suggestions) {
    console.error(`\n${s.line}`);
    for (const slot of s.slots) {
      const value = slot.value === true ? "" : ` = ${slot.value}`;
      console.error(`  ${pct(slot.probability)}  ${slot.slot}${value}`);
    }
  }
  console.error(`\n${ms} ms, ${result.usage.requests} requests, ${result.usage.input_tokens} input tokens`);
}

function fzf(lines: string[]): string | undefined {
  const r = spawnSync("fzf", ["--height=~10", "--prompt=nli> "], {
    input: lines.join("\n"),
    stdio: ["pipe", "pipe", "inherit"],
    encoding: "utf8",
  });
  return r.status === 0 ? r.stdout.trim() : undefined;
}

async function main() {
  loadDotEnv();
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      pick: { type: "boolean" },
      explain: { type: "boolean" },
      "dry-run": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [tool, ...words] = positionals;
  if (values.help || !tool || words.length === 0) {
    console.error(HELP);
    process.exit(values.help ? 0 : 1);
  }
  const request = words.join(" ");
  const spec = loadSpec(tool);

  if (values["dry-run"]) {
    const body = JSON.stringify({ state: { request }, questions: commandQuestion(spec) });
    console.error(`${spec.commands.length} subcommands, ${body.length} chars in the first request`);
    return;
  }

  const started = Date.now();
  const backend = createBackend();
  const result = await suggest(backend.ask, spec, request);
  if (values.explain) {
    console.error(backend.name);
    explain(result, Date.now() - started);
  }

  const [top] = result.suggestions;
  if (!top || result.ranking[0]!.path === NONE) {
    console.error(`nli: no ${tool} subcommand matches this request`);
    process.exit(1);
  }
  const lines = result.suggestions.map((s) => s.line);
  if (values.pick && lines.length > 1) {
    const picked = fzf(lines);
    if (!picked) process.exit(130);
    console.log(picked);
    return;
  }
  console.log(top.line);
  if (result.confidence < SURE && !values.explain && lines.length > 1) {
    console.error(`nli: low confidence (${result.confidence.toFixed(2)}); other candidates:`);
    for (const line of lines.slice(1)) console.error(`  ${line}`);
  }
}

main().catch((err: unknown) => {
  console.error(`nli: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
