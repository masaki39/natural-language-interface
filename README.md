# nli — natural language interface for CLIs

```console
$ nli gh 'リポジトリ一覧を取得'
gh repo list
$ nli docker 'composeで起動してバックグラウンドで'
docker compose up --detach
$ nli kubectl 'podの一覧をすべてのnamespaceで'
kubectl get pod --all-namespaces
```

Suggests a command line for a natural-language request. Nothing is executed.
Built on [TypeSafe Jev](https://docs.typesafe.ai/introduction), which answers typed
questions (Choice / Noul / Score) instead of generating text, so every subcommand and
flag in the output exists in the tool's spec. No LLM is involved; a suggestion takes ~0.5 s.

## How it works

1. A spec (commands, flags, positionals) is built once per tool and cached in
   `~/.cache/nli/specs/<tool>.json`, from the first source that works:
   - **gh**: `gh help reference`
   - **fig**: the [Fig autocomplete spec](https://github.com/withfig/autocomplete) for the tool
     (~700 CLIs: git, docker, kubectl, brew, npm, pnpm, uv, cargo, aws…), fetched from jsDelivr at a
     pinned version and evaluated in an empty `vm` context
   - **help**: the tool's `--help` output. Subcommands are probed with `--help` only when the root
     help shows cobra / clap / click / argparse, which handle `--help` before running anything.
2. The subcommand is a Choice over every command when they fit in one question (≤254 options).
   Bigger tools (aws) are walked group by group, and oversized levels are split into parallel
   chunks whose winners meet in a final round. Fig groups stored in separate files
   (`aws s3`, `docker compose`) are fetched the first time they are entered.
3. For the top 1–3 subcommands at once: a Noul per boolean flag, a Choice per enum flag, and a
   Choice per value flag / positional over spans extracted from the request
   (`src/candidates.ts`). Jev never writes a value; it only picks a span.
4. Code assembles the command line. Required arguments that were not found become `<placeholders>`.

## Setup

```sh
pnpm install
export OPENROUTER_API_KEY=...   # model ~typesafe/jev-latest via /api/alpha/decisions
# or TYPESAFE_API_KEY=...        # direct; both set → OpenRouter, force with NLI_BACKEND=typesafe
# (a gitignored .env next to package.json works too, see .env.example)

bin/nli gh 'PR一覧'                # or: pnpm nli gh 'PR一覧'
source shell/nli.zsh              # zsh widget (expects `nli` on PATH)
```

Type `gh マージ済みのプルリク` at the prompt and press `Ctrl-X Ctrl-N`: the line becomes
`gh pr list --state merged`, and nothing runs until you press Enter. When the answer is uncertain
an fzf picker shows the top candidates.

## Usage

```sh
nli <tool> <request...>             # command on stdout, notes on stderr
nli <tool> <request...> --explain   # probabilities, latency, tokens
nli <tool> <request...> --pick      # fzf over the candidates when unsure
nli <tool> --refresh                # rebuild the spec (after upgrading the tool)
nli <tool> --source help            # rebuild from a specific source: gh | fig | help

pnpm eval gh       # 37 Japanese gh requests (eval/gh.jsonl)
pnpm eval tools    # git, docker, kubectl, brew, uv, pnpm, aws, herdr (eval/tools.jsonl)
```
