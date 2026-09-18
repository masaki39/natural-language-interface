import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Flag = {
  long: string;
  short?: string;
  /** Value placeholder such as "string" or "int"; absent for boolean flags. */
  valueType?: string;
  /** Allowed values parsed from `{a|b|c}` in the description. */
  enum?: string[];
  description: string;
};

export type Positional = {
  name: string;
  required: boolean;
};

export type Command = {
  /** Subcommand path without the tool name, e.g. "repo list". */
  path: string;
  usage: string;
  summary: string;
  positionals: Positional[];
  flags: Flag[];
};

export type Spec = {
  tool: string;
  version: string;
  commands: Command[];
};

export const SPECS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "specs");

export function loadSpec(tool: string): Spec {
  const file = join(SPECS_DIR, `${tool}.json`);
  if (!existsSync(file)) {
    throw new Error(`spec not found: ${file} (run: pnpm gen-spec ${tool})`);
  }
  return JSON.parse(readFileSync(file, "utf8")) as Spec;
}

const HEADING = /^#{2,4} gh (.+)$/;
const FLAG_LINE = /^\s+(?:-([A-Za-z0-9]), )?--([A-Za-z0-9-]+)(?: (\S+))?\s{2,}(.*)$/;

/** Words of the usage line up to the first argument or flag placeholder. */
function commandPath(usage: string): string {
  const words: string[] = [];
  for (const word of usage.split(/\s+/)) {
    if (!/^[a-z][a-z0-9-]*$/.test(word)) break;
    words.push(word);
  }
  return words.join(" ");
}

function parsePositionals(usage: string, path: string): Positional[] {
  const rest = usage.slice(path.length);
  const positionals: Positional[] = [];
  // Only simple `<name>` / `[<name>]` forms; alternatives like `{<a> | <b>}` take the first name.
  const re = /(\[)?<([A-Za-z0-9_-]+)>/g;
  const seen = new Set<string>();
  for (const m of rest.matchAll(re)) {
    const name = m[2]!;
    if (name === "command" || seen.has(name)) continue;
    seen.add(name);
    const before = rest.slice(0, m.index);
    const optional = Boolean(m[1]) || before.lastIndexOf("[") > before.lastIndexOf("]") || /\{[^}]*$/.test(before);
    positionals.push({ name, required: !optional });
  }
  return positionals;
}

/** Parse the markdown emitted by `gh help reference` into a command spec. */
export function parseGhReference(markdown: string, version: string): Spec {
  const sections: Command[] = [];
  let current: Command | undefined;
  let summaryPending = false;

  for (const line of markdown.split("\n")) {
    const heading = line.match(HEADING);
    if (heading) {
      const usage = heading[1]!.trim();
      const path = commandPath(usage);
      current = { path, usage: `gh ${usage}`, summary: "", positionals: parsePositionals(usage, path), flags: [] };
      sections.push(current);
      summaryPending = true;
      continue;
    }
    if (!current) continue;
    if (summaryPending && line.trim() !== "") {
      current.summary = line.trim();
      summaryPending = false;
      continue;
    }
    const flag = line.match(FLAG_LINE);
    if (flag) {
      const [, short, long, valueType, description] = flag;
      const enumMatch = description!.match(/\{([^{}]+\|[^{}]+)\}/);
      current.flags.push({
        long: long!,
        ...(short ? { short } : {}),
        ...(valueType ? { valueType } : {}),
        ...(enumMatch ? { enum: enumMatch[1]!.split("|") } : {}),
        description: description!.trim(),
      });
    }
  }

  // A heading is a group (not runnable on its own) when another heading extends its path.
  const paths = sections.map((c) => c.path);
  const commands = sections.filter(
    (c) => c.path !== "" && !paths.some((p) => p !== c.path && p.startsWith(`${c.path} `)),
  );
  return { tool: "gh", version, commands };
}

export function generateSpec(tool: string): Spec {
  if (tool !== "gh") throw new Error(`no spec generator for ${tool} yet`);
  const markdown = execFileSync("gh", ["help", "reference"], { encoding: "utf8" });
  const version = execFileSync("gh", ["--version"], { encoding: "utf8" }).split("\n")[0]!;
  return parseGhReference(markdown, version);
}
