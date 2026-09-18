# AGENTS.md

Instructions for coding agents working on this repository.

## What nli is

`nli` turns a natural-language request (Japanese or English) into a command line for any CLI: gh, git, docker, kubectl, aws and ~700 others. It uses TypeSafe Jev, a model that only answers Choice / Noul / Score questions and never generates text: one Choice picks the subcommand, then one batched request fills flags and positionals. nli only suggests; it never executes the command. The zsh widget puts the suggestion on the prompt, and the user presses Enter to run it.

## Commands

- `pnpm install`
- `pnpm nli <tool> <request> [--explain]`: run `src/` directly via tsx (`--explain` shows probabilities, latency, tokens)
- `pnpm typecheck`: `tsc -p .` over `src/` and `scripts/`
- `pnpm build`: esbuild bundle to `dist/cli.js` (dependencies stay external)
- `pnpm eval gh` / `pnpm eval tools`: accuracy on `eval/<name>.jsonl`, results saved to `eval/results/`. Needs `OPENROUTER_API_KEY` or `TYPESAFE_API_KEY` (shell or `.env` at the repo root), and each run costs API calls, so don't run them in a loop
- `pnpm release <patch|minor|major|X.Y.Z> [--dry-run]`: see Releasing

## Layout

- `src/cli.ts`: entry point, argument parsing, `list` / `init zsh` / `update` / `--version`, fzf picker
- `src/engine.ts`: slot filling. Builds the flag and positional questions for the top candidates and assembles and quotes the command line
- `src/select.ts`: subcommand choice. Offers everything flat when it fits one Choice, otherwise walks groups level by level. Oversized lists are split into chunks asked in parallel, and the chunk finalists meet in a final round
- `src/spec.ts`: `Spec` / `Command` / `Flag` / `Group` types, source order (gh, then fig, then help), cache in `~/.cache/nli/specs` (honors `XDG_CACHE_HOME`), `SPEC_FORMAT`
- `src/sources/gh.ts`: parses `gh help reference`
- `src/sources/fig.ts`: Fig autocomplete specs from jsDelivr, including lazily loaded groups (`loadSpec`)
- `src/sources/help.ts`: fallback parser for `--help` output
- `src/candidates.ts`: `extractCandidates`, the verbatim request spans a value can come from
- `src/backend.ts`: OpenRouter `/api/alpha/decisions` or the TypeSafe SDK (`NLI_BACKEND`, `NLI_MODEL`), `.env` loading
- `src/list.ts`: `nli list`, the installed tools that have a spec source
- `src/update.ts`: `nli update [--check]` against the latest GitHub release
- `shell/nli.zsh`: zsh widget printed by `nli init zsh` (Enter on `nli <tool> <request>`, and `NLI_KEY` for `<tool> <request>`)
- `scripts/`: `eval.ts` (accuracy runs) and `release.ts` (version bump, tag and push)
- `eval/`: `gh.jsonl` and `tools.jsonl` test cases; `results/` is gitignored
- `.github/workflows/`: `ci.yml` (typecheck, build, `--version` smoke test) and `release.yml` (publish on `v*` tags)

## Design rules that must hold

- Jev never writes values. Every argument or flag value is a verbatim span from `extractCandidates` (or an enum value from the spec), offered as Choice options. Don't add LLM calls or free-text generation: a suggestion takes about 0.5 s, and that latency is a product requirement. Keep it to one selection round (more only when the list has to be split or walked) plus one slot-filling request.
- A Choice takes at most 255 options; `MAX_OPTIONS = 254` keeps one for `NONE`. Respect `MAX_OPTIONS`, `MAX_CHARS` and `FINALISTS_PER_CHUNK` in `select.ts` instead of building bigger questions.
- `sources/help.ts` probes subcommands with `--help` only when the root help shows a known framework marker (cobra, clap, click, argparse). A hand-rolled CLI might treat `tool delete --help` as a delete. Keep `MAX_DEPTH` and `MAX_PROBES`.
- Fig specs are pinned (`FIG_VERSION`) and run in an empty `vm` context (no `require`, `process` or `fetch`) with a timeout. Don't unpin them or evaluate them in the main context.
- Bump `SPEC_FORMAT` in `spec.ts` whenever parsing output changes, so cached specs from older code are rebuilt.
- The zsh widget binds Enter (`^M`) to `nli-enter` and falls back to `zle accept-line`. It must not redefine `accept-line`: dotfiles and plugins loaded after `eval "$(nli init zsh)"` often replace or wrap `accept-line`, which silently dropped nli's Enter behavior. Calling it by name keeps whatever it ends up being.
- For suggestions, stdout carries only the command line. Explanations, warnings, low-confidence alternatives and errors go to stderr, because the widget captures stdout. Errors are one line prefixed `nli:`.

## Conventions

- pnpm only (see `packageManager`). Never npm or npx; use `pnpm dlx`.
- Node >= 22, ESM, TypeScript imports with `.ts` extensions (`allowImportingTsExtensions`).
- Match the existing style: short functions, doc comments on non-obvious functions and constants (say why), no new runtime dependencies without a strong reason (the only one is `@typesafe-ai/sdk`).
- `README.md` is user-facing: English, short, emoji headings, GitHub callouts (`> [!NOTE]`).

## Testing changes

- Always run `pnpm typecheck` and `pnpm build`.
- For changes to the engine, selection, prompts, sources or candidates, run `pnpm eval gh` and `pnpm eval tools` and compare with the last numbers: gh 36/37 top-1 and 28/29 exact lines; tools 26/26 top-1 and 17/19 exact lines. Report regressions instead of hiding them.
- Test changes to `shell/nli.zsh` in a real interactive zsh on a pty with the widget loaded from `.zshrc`, not by sourcing it into a running shell. Load order matters (see the `accept-line` rule), so a shell that sources it after startup can pass while a real one fails.

## Releasing

- `pnpm release patch` (or `minor`, `major`, `X.Y.Z`; `--dry-run` to preview) checks that the tree is clean, you are on `main` and `main` matches `origin/main`. It then bumps `package.json`, commits `Release vX.Y.Z`, tags and pushes.
- The tag triggers `release.yml`: typecheck, a check that the tag matches `package.json`, `pnpm pack`, and a GitHub release with the asset renamed to `natural-language-interface.tgz`. Keep that versionless name: the install URL (`releases/latest/download/natural-language-interface.tgz`) depends on it.
- Users install and update from that tarball (`nli update`). Don't switch to `pnpm add -g github:...`: pnpm refuses to run build scripts for git-hosted packages.
- Don't commit, tag or release unless the user asks.
