import { execFileSync } from "node:child_process";
import { usagePositionals, type Command, type Spec } from "../spec.ts";

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


/** Parse the markdown emitted by `gh help reference` into a command spec. */
export function parseGhReference(markdown: string, version: string): Omit<Spec, "format"> {
  const sections: Command[] = [];
  let current: Command | undefined;
  let summaryPending = false;

  for (const line of markdown.split("\n")) {
    const heading = line.match(HEADING);
    if (heading) {
      const usage = heading[1]!.trim();
      const path = commandPath(usage);
      current = { path, usage: `gh ${usage}`, summary: "", positionals: usagePositionals(usage.slice(path.length)), flags: [] };
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
        long: `--${long}`,
        ...(short ? { short: `-${short}` } : {}),
        ...(valueType ? { valueType } : {}),
        ...(enumMatch ? { enum: enumMatch[1]!.split("|") } : {}),
        description: description!.trim(),
      });
    }
  }

  // A heading is a group (not runnable on its own) when another heading extends its path.
  const paths = sections.map((c) => c.path);
  const isGroup = (c: Command) => paths.some((p) => p !== c.path && p.startsWith(`${c.path} `));
  const commands = sections.filter((c) => c.path !== "" && !isGroup(c));
  const groups = sections.filter((c) => c.path !== "" && isGroup(c)).map((c) => ({ path: c.path, summary: c.summary }));
  return { tool: "gh", source: "gh", version, commands, groups };
}

/** gh documents every command in one markdown page, which beats any third-party spec. */
export function ghSpec(): Omit<Spec, "format"> {
  const markdown = execFileSync("gh", ["help", "reference"], { encoding: "utf8" });
  const version = execFileSync("gh", ["--version"], { encoding: "utf8" }).split("\n")[0]!;
  return parseGhReference(markdown, version);
}
