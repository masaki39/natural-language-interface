import { spawnSync } from "node:child_process";

const LATEST = "https://api.github.com/repos/masaki39/natural-language-interface/releases/latest";
const TARBALL = "https://github.com/masaki39/natural-language-interface/releases/latest/download/natural-language-interface.tgz";

/** Tag of the latest GitHub release, without the leading v. */
async function latestVersion(): Promise<string> {
  const res = await fetch(LATEST, { headers: { accept: "application/vnd.github+json" } }).catch((err: Error) => {
    throw new Error(`could not reach GitHub: ${err.cause instanceof Error ? err.cause.message : err.message}`);
  });
  if (!res.ok) throw new Error(`GitHub API returned ${res.status} ${res.statusText} for the latest release`);
  const { tag_name } = (await res.json()) as { tag_name?: string };
  if (!tag_name) throw new Error("the latest release has no tag_name");
  return tag_name.replace(/^v/, "");
}

/** Numeric X.Y.Z comparison: negative when a is older than b. */
function compare(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/**
 * Reinstall from the latest release tarball when it is newer than `current`.
 * Returns the exit status. A source checkout (run via tsx) is never reinstalled.
 */
export async function update(current: string, opts: { check: boolean; fromSource: boolean }): Promise<number> {
  if (opts.fromSource && !opts.check) {
    console.error("nli: this is a source checkout; update it with git pull");
    return 0;
  }
  const latest = await latestVersion();
  if (compare(current, latest) >= 0) {
    console.log(`nli ${current} is up to date`);
    return 0;
  }
  if (opts.check) {
    console.log(`nli ${latest} is available (installed: ${current}); run nli update`);
    return 0;
  }
  console.log(`Updating nli ${current} → ${latest}`);
  const r = spawnSync("pnpm", ["add", "-g", TARBALL], { stdio: "inherit" });
  if (r.error) throw new Error(`could not run pnpm: ${r.error.message}`);
  return r.status ?? 1;
}
