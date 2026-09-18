import { spawnSync } from "node:child_process";
import { summarize, usagePositionals, type Command, type Flag, type Group, type Positional, type Spec } from "../spec.ts";

/**
 * Last resort for tools without a Fig spec: read `--help` output. Subcommands are only probed
 * with `--help` when the root help shows a framework (cobra, clap, click, argparse) that handles
 * `--help` itself; a hand-rolled CLI might otherwise run `tool delete --help` as a delete.
 */
const FRAMEWORK_MARKERS = [
  /Use ["`]\S+ [^"`]*--help/, // cobra (gh quotes with backticks)
  /Print help/, // clap
  /Show this message and exit/, // click
  /show this help message and exit/, // argparse
];

const MAX_DEPTH = 2;
const MAX_PROBES = 150;

const SECTION = /^(?:[A-Z][\w ]*\s)?(?:sub)?commands:?$/i;
const FLAG_LINE = /^\s{1,12}(?:(-[A-Za-z0-9]),?\s+)?(--?[A-Za-z0-9][\w-]*)(?:[ =]([<[]?[\w.|-]+[>\]]?))?\s{2,}(\S.*)$/;

function help(tool: string, path: string[]): string {
  const r = spawnSync(tool, [...path, "--help"], {
    encoding: "utf8",
    timeout: 3_000,
    env: { ...process.env, NO_COLOR: "1", TERM: "dumb", PAGER: "cat", LANG: "C" },
  });
  return `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
}

/**
 * `  name, alias   Summary` (cobra, clap, click), `  name:   Summary` (gh), or the hand-rolled `  tool server stop [x]  Summary`
 * with the tool name repeated and multi-word paths.
 */
function commandLine(tool: string) {
  const escaped = tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s{1,8}(?:${escaped}\\s+)?([a-z][\\w-]*(?: [a-z][\\w-]*)*):?(?:,\\s*[\\w-]+)*(?: [<[{][^\\s]*)*\\s{2,}(\\S.*)$`);
}

type Parsed = { subcommands: { name: string; summary: string }[]; flags: Flag[]; positionals: Positional[]; usage: string };

function parse(text: string, tool: string, path: string[]): Parsed {
  const lines = text.split("\n");
  const subcommands: Parsed["subcommands"] = [];
  const flags: Flag[] = [];
  const COMMAND_LINE = commandLine(tool);
  let inCommands = false;

  for (const line of lines) {
    if (line.trim() === "") continue;
    if (!/^\s/.test(line)) {
      inCommands = SECTION.test(line.trim());
      continue;
    }
    const cmd = inCommands ? line.match(COMMAND_LINE) : null;
    if (cmd && cmd[1] !== "help" && cmd[1] !== tool && !subcommands.some((s) => s.name === cmd[1])) {
      subcommands.push({ name: cmd[1]!, summary: summarize(cmd[2]) });
      continue;
    }
    const flag = line.match(FLAG_LINE);
    if (flag && flag[2] !== "--help" && flag[2] !== "--version") {
      const [, short, long, value, description] = flag;
      const values = description!.match(/\[possible values: ([^\]]+)\]/)?.[1]?.split(/,\s*/)
        ?? description!.match(/\{([^{}\s]+(?:\|[^{}\s]+)+)\}/)?.[1]?.split("|")
        ?? value?.match(/^[<[]?([\w-]+(?:\|[\w-]+)+)[>\]]?$/)?.[1]?.split("|");
      flags.push({
        long: long!,
        ...(short ? { short } : {}),
        ...(value ? { valueType: value.replace(/[<>[\]]/g, "") } : {}),
        ...(values ? { enum: values } : {}),
        description: summarize(description),
      });
    }
  }

  // `Usage: tool sub <x>` on one line, or a `USAGE` heading with the usage on the next line (gh).
  const at = lines.findIndex((l) => /^\s*usage:?(\s|$)/i.test(l));
  const inline = at >= 0 ? lines[at]!.replace(/^\s*usage:?\s*/i, "").trim() : "";
  const usageLine = inline || (at >= 0 ? lines.slice(at + 1).find((l) => l.trim())?.trim() : undefined) || [tool, ...path].join(" ");
  return { subcommands, flags, positionals: usagePositionals(usageLine), usage: usageLine };
}

export function helpSpec(tool: string): Omit<Spec, "format"> {
  const commands: Command[] = [];
  const groups: Group[] = [];
  const rootText = help(tool, []);
  if (!rootText.trim()) throw new Error(`${tool} --help printed nothing`);
  const recurse = FRAMEWORK_MARKERS.some((m) => m.test(rootText));
  let probes = 0;

  const visit = (path: string[], text: string, summary: string) => {
    const parsed = parse(text, tool, path);
    const p = path.join(" ");
    const canDescend = recurse && path.length < MAX_DEPTH;
    if (parsed.subcommands.length > 0) groups.push({ path: p, summary });
    if (parsed.subcommands.length === 0 || parsed.positionals.length > 0) {
      commands.push({ path: p, usage: parsed.usage, summary, positionals: parsed.positionals, flags: parsed.flags });
    }
    for (const sub of parsed.subcommands) {
      const subPath = [...path, sub.name];
      if (canDescend && probes++ < MAX_PROBES) {
        visit(subPath, help(tool, subPath), sub.summary);
      } else {
        // Without probing, a listed subcommand is still selectable; its flags stay unknown.
        commands.push({ path: subPath.join(" "), usage: `${tool} ${subPath.join(" ")}`, summary: sub.summary, positionals: [], flags: [] });
      }
    }
  };

  visit([], rootText, "");
  const version = spawnSync(tool, ["--version"], { encoding: "utf8", timeout: 3_000 }).stdout?.split("\n")[0] ?? "";
  return { tool, source: "help", version, commands, groups: groups.filter((g) => g.path !== "") };
}
