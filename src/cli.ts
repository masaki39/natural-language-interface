#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createBackend, loadDotEnv } from "./backend.ts";
import { NONE, suggest, type Result } from "./engine.ts";
import { listTools } from "./list.ts";
import { update } from "./update.ts";
import { getSpec, SOURCES, type Source } from "./spec.ts";

/** Below this subcommand confidence, alternatives are shown next to the top answer. */
const SURE = 0.6;

const HELP = `usage: nli <tool> <request...> [options]
       nli list        tools nli can use (installed, with a spec source)
       nli init zsh    print the zsh keybindings; add eval "$(nli init zsh)" to ~/.zshrc
       nli update      install the latest release (--check: only report)
       nli --version   print the installed version

Suggest a command line for a natural-language request. Nothing is executed:
the command goes to stdout, explanations go to stderr.

  --pick      choose among the top candidates with fzf when unsure
  --explain   show probabilities, latency and token usage
  --refresh   rebuild the tool's spec (cached in ~/.cache/nli/specs)
  --source    where to build the spec from: gh | fig | help
              (default: gh for gh, else a Fig autocomplete spec, else --help)

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

/** The picked line, undefined when cancelled, or the top line when fzf isn't installed. */
function fzf(lines: string[]): string | undefined {
  const r = spawnSync("fzf", ["--height=~10", "--prompt=nli> "], {
    input: lines.join("\n"),
    stdio: ["pipe", "pipe", "inherit"],
    encoding: "utf8",
  });
  if (r.error) return lines[0];
  return r.status === 0 ? r.stdout.trim() : undefined;
}

/** The package root holds shell/ and package.json, next to both src/ (tsx) and dist/ (installed). */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function printInit(shell: string | undefined) {
  if (shell !== "zsh") throw new Error(`nli init supports zsh only (got ${shell ?? "nothing"})`);
  process.stdout.write(readFileSync(join(ROOT, "shell", "nli.zsh"), "utf8"));
}

function version(): string {
  return (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }).version;
}

async function main() {
  if (process.argv[2] === "init") return printInit(process.argv[3]);
  if (process.argv[2] === "list" && process.argv.length === 3) return console.log(await listTools());
  if (process.argv[2] === "update") {
    const fromSource = basename(dirname(fileURLToPath(import.meta.url))) === "src";
    return process.exit(await update(version(), { check: process.argv.includes("--check"), fromSource }));
  }
  loadDotEnv();
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      pick: { type: "boolean" },
      explain: { type: "boolean" },
      refresh: { type: "boolean" },
      source: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  if (values.version) return console.log(version());
  const [tool, ...words] = positionals;
  const refreshOnly = Boolean(values.refresh || values.source) && words.length === 0;
  if (values.help || !tool || (words.length === 0 && !refreshOnly)) {
    console.error(HELP);
    process.exit(values.help ? 0 : 1);
  }
  const source = values.source as Source | undefined;
  if (source && !SOURCES.includes(source)) throw new Error(`unknown --source ${source} (${SOURCES.join(" | ")})`);
  const spec = await getSpec(tool, { refresh: values.refresh, source });
  if (refreshOnly) {
    console.error(`${tool}: ${spec.commands.length} commands, ${spec.groups.length} groups from ${spec.source} (${spec.version})`);
    return;
  }
  const request = words.join(" ");

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
  // Confident answers go straight through; the picker is only worth a keystroke when unsure.
  if (values.pick && lines.length > 1 && result.confidence < SURE) {
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
