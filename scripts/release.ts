import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const USAGE = "usage: pnpm release <patch|minor|major|X.Y.Z> [--dry-run]";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const bump = args.find((a) => !a.startsWith("--"));
if (!bump) {
  console.error(USAGE);
  process.exit(1);
}

function git(...a: string[]): string {
  return execFileSync("git", a, { encoding: "utf8" }).trim();
}

/** The version after `bump`, which is patch | minor | major or an explicit X.Y.Z. */
function next(current: string, bump: string): string {
  if (/^\d+\.\d+\.\d+$/.test(bump)) return bump;
  const [major, minor, patch] = current.split(".").map(Number) as [number, number, number];
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`unknown bump ${bump}\n${USAGE}`);
}

/** Reasons the release can't go ahead: dirty tree, wrong branch, or main out of sync with origin. */
function problems(tag: string): string[] {
  const found = [];
  if (git("status", "--porcelain")) found.push("working tree is not clean");
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  if (branch !== "main") found.push(`on ${branch}, not main`);
  git("fetch", "--quiet", "--tags", "origin", "main");
  if (git("rev-parse", "main") !== git("rev-parse", "origin/main")) found.push("main differs from origin/main");
  if (git("tag", "--list", tag)) found.push(`tag ${tag} already exists`);
  return found;
}

const pkgText = readFileSync("package.json", "utf8");
const current = (JSON.parse(pkgText) as { version: string }).version;
const version = next(current, bump);
const tag = `v${version}`;

const found = problems(tag);
for (const p of found) console.error(`${dryRun ? "warning" : "release"}: ${p}`);
if (found.length > 0 && !dryRun) process.exit(1);

console.log(`${current} → ${version}`);
const steps: [string, () => void][] = [
  [`set version ${version} in package.json`, () => writeFileSync("package.json", pkgText.replace(/"version": "[^"]*"/, `"version": "${version}"`))],
  [`git commit -m "Release ${tag}"`, () => git("commit", "--quiet", "-m", `Release ${tag}`, "package.json")],
  [`git tag ${tag}`, () => git("tag", tag)],
  [`git push --atomic origin main ${tag}`, () => git("push", "--atomic", "origin", "main", tag)],
];
for (const [label, run] of steps) {
  console.log(`${dryRun ? "would" : "→"} ${label}`);
  if (!dryRun) run();
}
if (dryRun) console.log("dry run: nothing changed");
else console.log(`pushed ${tag}; the release workflow publishes it`);
