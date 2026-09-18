# nli

Turn a natural-language request into a command line. Works with gh, git, docker, kubectl, brew, aws and ~700 other CLIs. Nothing is executed.

```console
$ nli gh 'list merged pull requests'
gh pr list --state merged
$ nli docker 'composeで起動してバックグラウンドで'
docker compose up --detach
```

nli uses [TypeSafe Jev](https://docs.typesafe.ai/introduction), a model that picks from options instead of writing text. Every subcommand and flag it suggests exists in the tool, and a suggestion takes about 0.5 s.

## Install

```sh
pnpm add -g https://github.com/masaki39/natural-language-interface/releases/latest/download/natural-language-interface.tgz
```

Add to `~/.zshrc`:

```sh
export OPENROUTER_API_KEY=...   # or TYPESAFE_API_KEY=...
eval "$(nli init zsh)"
```

Uninstall with `pnpm remove -g natural-language-interface`.

## Usage

Type `nli`, a tool and a request, then press **Enter**. The line is replaced with the command; press Enter again to run it.

```
nli gh リポジトリ一覧   →   gh repo list
```

Without the `nli` prefix, press **Ctrl-X Ctrl-N** instead (`gh リポジトリ一覧` → `gh repo list`).

Or call it directly:

```sh
nli <tool> <request>             # print the suggested command
nli <tool> <request> --explain   # show probabilities and timing
nli list                         # tools nli can use on this machine
nli <tool> --refresh             # re-read the tool's commands (after upgrading it)
```

Set these before the `eval` to customize the widget:

- `NLI_KEY='^[n'` — use Alt-N instead of Ctrl-X Ctrl-N
- `NLI_ENTER=0` — make Enter on `nli ...` run it as a normal command

## How it works

1. nli reads the tool's commands once and caches them in `~/.cache/nli/specs`: from `gh help reference` for gh, from [Fig autocomplete specs](https://github.com/withfig/autocomplete) for most tools, or from `--help` for the rest.
2. Jev picks the subcommand, then the flags, from that list.
3. Values like `cli/cli` or `50` are copied from your request, never invented. Missing required arguments are shown as `<placeholders>`.

## Development

```sh
pnpm install
pnpm nli gh 'PR一覧' --explain   # run from source
pnpm eval gh                     # accuracy on eval/gh.jsonl
pnpm typecheck && pnpm build
```

Release: `pnpm pack`, rename the tarball to `natural-language-interface.tgz`, then `gh release create v<version> natural-language-interface.tgz`.
