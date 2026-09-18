import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { expandFigGroup, figSpec } from "./sources/fig.ts";
import { ghSpec } from "./sources/gh.ts";
import { helpSpec } from "./sources/help.ts";

export type Flag = {
  /** As typed on the command line: "--limit", or "-name" for single-dash tools like find. */
  long: string;
  /** As typed on the command line: "-L". */
  short?: string;
  /** Value placeholder such as "string" or "int"; absent for boolean flags. */
  valueType?: string;
  /** Allowed values, when the source lists them. */
  enum?: string[];
  description: string;
};

export type Positional = {
  name: string;
  required: boolean;
};

export type Command = {
  /** Subcommand path without the tool name, e.g. "repo list"; "" for the tool itself. */
  path: string;
  usage: string;
  summary: string;
  positionals: Positional[];
  flags: Flag[];
};

/** A node that only holds subcommands. Selection descends through groups when a tool is too big to list flat. */
export type Group = {
  path: string;
  summary: string;
  /** Fig spec file holding this group's subcommands, fetched when selection first enters the group. */
  load?: string;
};

export const SOURCES = ["gh", "fig", "help"] as const;
export type Source = (typeof SOURCES)[number];

/** Bump when parsing changes, so cached specs from older code are rebuilt on next use. */
const SPEC_FORMAT = 2;

export type Spec = {
  format: number;
  tool: string;
  source: Source;
  version: string;
  commands: Command[];
  groups: Group[];
};

/** Keep criteria short: the first sentence is what separates one command from another. */
export function summarize(text: string | undefined, max = 160): string {
  const line = (text ?? "").replace(/\s+/g, " ").trim();
  const sentence = line.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? line;
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

/**
 * Positionals in the argument part of a usage line. `[<a>]`, `[<a> | <b>]` and `{<a> | --all}`
 * are optional; alternatives each become a slot, and span dedup keeps one value per span.
 */
export function usagePositionals(args: string): Positional[] {
  const positionals: Positional[] = [];
  for (const m of args.matchAll(/(\[)?<([\w-]+)>/g)) {
    const name = m[2]!;
    if (/^(command|subcommand|options?|flags?)$/i.test(name) || positionals.some((p) => p.name === name)) continue;
    const before = args.slice(0, m.index);
    const optional = Boolean(m[1]) || before.lastIndexOf("[") > before.lastIndexOf("]") || /\{[^}]*$/.test(before);
    positionals.push({ name, required: !optional });
  }
  return positionals;
}

const CACHE_DIR = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "nli", "specs");

function cacheFile(tool: string) {
  return join(CACHE_DIR, `${tool}.json`);
}

export function saveSpec(spec: Spec) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cacheFile(spec.tool), `${JSON.stringify(spec, null, 2)}\n`);
}

async function generate(tool: string, source: Source): Promise<Omit<Spec, "format">> {
  switch (source) {
    case "gh":
      return ghSpec();
    case "fig":
      return figSpec(tool);
    case "help":
      return helpSpec(tool);
  }
}

/**
 * Build a spec from the most accurate source available: gh's own reference, then the
 * Fig autocomplete spec, then the tool's --help output. Specs are cached until --refresh.
 */
export async function getSpec(tool: string, { refresh = false, source }: { refresh?: boolean; source?: Source } = {}) {
  if (!refresh && !source && existsSync(cacheFile(tool))) {
    const cached = JSON.parse(readFileSync(cacheFile(tool), "utf8")) as Spec;
    if (cached.format === SPEC_FORMAT) return cached;
    source = cached.source;
  }
  const order: Source[] = source ? [source] : tool === "gh" ? ["gh"] : ["fig", "help"];
  const errors: string[] = [];
  for (const s of order) {
    try {
      const spec = { ...(await generate(tool, s)), format: SPEC_FORMAT };
      if (spec.commands.length === 0 && spec.groups.length === 0) throw new Error("no commands found");
      saveSpec(spec);
      return spec;
    } catch (err) {
      errors.push(`${s}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`could not build a spec for ${tool} (${errors.join("; ")})`);
}

/** Fill a lazily loaded group in place and persist it, so the fetch happens once. */
export async function expandGroup(spec: Spec, group: Group) {
  if (!group.load) return;
  const loaded = await expandFigGroup(spec.tool, group.path, group.load);
  spec.commands.push(...loaded.commands);
  spec.groups.push(...loaded.groups);
  delete group.load;
  saveSpec(spec);
}
