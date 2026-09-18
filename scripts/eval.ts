import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createBackend, loadDotEnv } from "../src/backend.ts";
import { NONE, suggest } from "../src/engine.ts";
import { loadSpec } from "../src/spec.ts";

type Case = { request: string; path: string; line?: string };

const tool = process.argv[2] ?? "gh";
const cases = readFileSync(`eval/${tool}.jsonl`, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Case);
const spec = loadSpec(tool);
loadDotEnv();
const backend = createBackend();
console.log(backend.name);

const rows = [];
for (const c of cases) {
  const started = Date.now();
  const r = await suggest(backend.ask, spec, c.request);
  const ms = Date.now() - started;
  const top = r.ranking[0]!;
  const row = {
    ...c,
    got: top.path,
    got_line: top.path === NONE ? undefined : r.suggestions[0]?.line,
    confidence: r.confidence,
    top1: top.path === c.path,
    top3: r.ranking.slice(0, 3).some((x) => x.path === c.path),
    line_ok: c.line === undefined ? undefined : r.suggestions[0]?.line === c.line,
    ms,
    tokens: r.usage.input_tokens,
  };
  rows.push(row);
  const mark = row.top1 ? (row.line_ok === false ? "~" : "✓") : "✗";
  console.log(`${mark} ${row.confidence.toFixed(2)} ${String(ms).padStart(5)}ms  ${c.request}  →  ${row.got_line ?? row.got}`);
}

const rate = (xs: boolean[]) => `${xs.filter(Boolean).length}/${xs.length} (${((xs.filter(Boolean).length / xs.length) * 100).toFixed(0)}%)`;
const lines = rows.filter((r) => r.line_ok !== undefined).map((r) => r.line_ok!);
const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
console.log(`
subcommand top1  ${rate(rows.map((r) => r.top1))}
subcommand top3  ${rate(rows.map((r) => r.top3))}
full line exact  ${rate(lines)}
latency p50/p90  ${ms[Math.floor(ms.length * 0.5)]} / ${ms[Math.floor(ms.length * 0.9)]} ms
input tokens     ${rows.reduce((s, r) => s + r.tokens, 0)} total`);

// Calibration check: accuracy of answers above and below the CLI's confidence cutoff.
for (const [label, subset] of [
  ["confidence >= 0.6", rows.filter((r) => r.confidence >= 0.6)],
  ["confidence <  0.6", rows.filter((r) => r.confidence < 0.6)],
] as const) {
  if (subset.length) console.log(`${label}  top1 ${rate(subset.map((r) => r.top1))}`);
}

mkdirSync("eval/results", { recursive: true });
const out = `eval/results/${tool}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(out, JSON.stringify(rows, null, 2));
console.log(`\n${out}`);
