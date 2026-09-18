import { runInNewContext } from "node:vm";
import { summarize, type Command, type Flag, type Group, type Positional, type Spec } from "../spec.ts";

/**
 * Fig autocomplete specs (withfig/autocomplete) cover ~700 CLIs with subcommands, options and
 * descriptions. Pinned so a compromised or changed release can't slip in unnoticed.
 */
const FIG_VERSION = "2.692.3";
const FIG_CDN = `https://cdn.jsdelivr.net/npm/@withfig/autocomplete@${FIG_VERSION}/build`;

type FigName = string | string[];
type FigArg = { name?: string; isOptional?: boolean; suggestions?: unknown[] };
type FigOption = { name: FigName; description?: string; args?: FigArg | FigArg[]; hidden?: boolean; isPersistent?: boolean };
type FigCommand = {
  name: FigName;
  description?: string;
  args?: FigArg | FigArg[];
  options?: FigOption[];
  subcommands?: FigCommand[];
  hidden?: boolean;
  requiresSubcommand?: boolean;
  loadSpec?: unknown;
};

const list = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/**
 * Specs are esbuild bundles ending in `export{x as default}`. Rewriting the export and running the
 * bundle in a fresh context (no require, process or fetch) is enough to read the object literal.
 */
async function fetchFig(name: string): Promise<FigCommand> {
  const res = await fetch(`${FIG_CDN}/${name}.js`, { signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) throw new Error(`no Fig spec for ${name}`);
  if (!res.ok) throw new Error(`Fig CDN ${res.status} for ${name}`);
  const code = await res.text();
  const exported = code.match(/export\s*\{([^}]*)\}\s*;?\s*$/);
  const local = exported?.[1]!.split(",").map((s) => s.trim().match(/^([\w$]+)\s+as\s+default$/)?.[1]).find(Boolean);
  if (!exported || !local) throw new Error(`unexpected Fig bundle format for ${name}`);
  const context: { __spec?: FigCommand } = {};
  runInNewContext(`${code.slice(0, exported.index)};globalThis.__spec=${local};`, context, { timeout: 2_000 });
  return context.__spec!;
}

function toFlag(o: FigOption): Flag | undefined {
  const names = list(o.name);
  const long = names.find((n) => n.startsWith("--")) ?? names.find((n) => n.startsWith("-"));
  if (!long || o.hidden) return undefined;
  const short = names.find((n) => /^-[^-]$/.test(n));
  const arg = list(o.args)[0];
  const values = arg?.suggestions
    ?.map((s) => (typeof s === "string" ? s : (s as { name?: unknown })?.name))
    .filter((s): s is string => typeof s === "string");
  return {
    long,
    ...(short && short !== long ? { short } : {}),
    ...(arg ? { valueType: arg.name ?? "value" } : {}),
    ...(values?.length ? { enum: values } : {}),
    description: summarize(o.description) || long,
  };
}

function toPositionals(args: FigArg | FigArg[] | undefined): Positional[] {
  return list(args).map((a, i) => {
    const raw = (a.name ?? `arg${i + 1}`).trim();
    // Some specs write optionality into the name ("[REPOSITORY[:TAG]]") instead of isOptional.
    const bracketed = raw.startsWith("[");
    const name = raw.replace(/[[\]<>]/g, "").replace(/\s+/g, "-") || `arg${i + 1}`;
    return { name, required: !a.isOptional && !bracketed };
  });
}

/** Flatten a Fig command tree under `prefix` into runnable commands and groups. */
function convert(root: FigCommand, tool: string, prefix: string): Pick<Spec, "commands" | "groups"> {
  const commands: Command[] = [];
  const groups: Group[] = [];

  const walk = (node: FigCommand, path: string, inherited: FigOption[]) => {
    const own = list(node.options);
    const persistent = [...inherited, ...own.filter((o) => o.isPersistent)];
    const subs = list(node.subcommands).filter((s) => !s.hidden);
    const lazy = typeof node.loadSpec === "string" ? node.loadSpec : undefined;
    const summary = summarize(node.description);

    if (subs.length > 0 || lazy) {
      groups.push({ path, summary, ...(lazy ? { load: lazy } : {}) });
    }
    // A node with subcommands also runs on its own when it takes arguments (`git stash <message>`, `rg <pattern>`).
    const runnable = (subs.length === 0 && !lazy) || (!node.requiresSubcommand && list(node.args).length > 0);
    if (runnable) {
      const flags = [...inherited, ...own].map(toFlag).filter((f): f is Flag => f !== undefined);
      const positionals = toPositionals(node.args);
      const usage = [tool, path, ...positionals.map((p) => (p.required ? `<${p.name}>` : `[<${p.name}>]`))].filter(Boolean).join(" ");
      commands.push({ path, usage, summary, positionals, flags });
    }
    for (const sub of subs) walk(sub, [path, list(sub.name)[0]!].filter(Boolean).join(" "), persistent);
  };

  walk(root, prefix, []);
  // The root, or the group being expanded, is already known to the caller.
  return { commands, groups: groups.filter((g) => g.path !== prefix) };
}

/** Names of the tools that have a Fig spec, from jsDelivr's file listing of the pinned release. */
export async function figIndex(): Promise<string[]> {
  const url = `https://data.jsdelivr.com/v1/packages/npm/@withfig/autocomplete@${FIG_VERSION}?structure=flat`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`jsDelivr ${res.status} listing Fig specs`);
  const { files } = (await res.json()) as { files: { name: string }[] };
  return files.map((f) => f.name.match(/^\/build\/([^/]+)\.js$/)?.[1]).filter((n): n is string => Boolean(n));
}

export async function figSpec(tool: string): Promise<Omit<Spec, "format">> {
  const root = await fetchFig(tool);
  return { tool, source: "fig", version: `@withfig/autocomplete@${FIG_VERSION}`, ...convert(root, tool, "") };
}

export async function expandFigGroup(tool: string, path: string, load: string): Promise<Pick<Spec, "commands" | "groups">> {
  return convert(await fetchFig(load), tool, path);
}
