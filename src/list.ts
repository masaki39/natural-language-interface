import { accessSync, constants, readdirSync } from "node:fs";
import { join } from "node:path";
import { cachedSpecs, figTools, type Source } from "./spec.ts";

/** Executable names on PATH. */
function pathCommands(): Set<string> {
  const names = new Set<string>();
  for (const dir of (process.env.PATH ?? "").split(":")) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      try {
        accessSync(join(dir, name), constants.X_OK);
        names.add(name);
      } catch {
        // Not executable.
      }
    }
  }
  return names;
}

/**
 * Installed commands nli has a spec source for: gh's own reference, a Fig spec, or an already
 * cached spec (including ones built from --help). Anything else can still try `--source help`.
 */
export async function listTools(): Promise<string> {
  const installed = pathCommands();
  const fig = await figTools();
  const cached = cachedSpecs();
  const rows: [string, Source, boolean][] = [];
  for (const tool of installed) {
    const source: Source | undefined = cached.get(tool) ?? (tool === "gh" ? "gh" : fig.has(tool) ? "fig" : undefined);
    if (source) rows.push([tool, source, cached.has(tool)]);
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  const width = Math.max(...rows.map((r) => r[0].length), 4);
  const lines = rows.map(([tool, source, isCached]) => `${tool.padEnd(width)}  ${source.padEnd(4)}  ${isCached ? "cached" : ""}`.trimEnd());
  return [
    ...lines,
    "",
    `${rows.length} tools. Others may work from their --help: nli <tool> --source help`,
  ].join("\n");
}
