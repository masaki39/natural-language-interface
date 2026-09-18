# nli — natural language interface for CLIs

```console
$ nli gh 'リポジトリ一覧を取得'
gh repo list
```

Suggests a command line for a natural-language request. Nothing is executed.
Built on [TypeSafe Jev](https://docs.typesafe.ai/introduction), which answers typed
questions (Choice / Noul / Score) instead of generating text, so every subcommand and
flag in the output exists in the tool's spec.

## How it works

1. `specs/gh.json` is parsed from `gh help reference` (`pnpm gen-spec gh`).
2. Request 1: a Choice over all 197 subcommands (plus "none of these").
3. Request 2: for the top 1–3 subcommands at once, a Noul per boolean flag, a Choice per
   enum flag, and a Choice per value flag / positional over spans extracted from the
   request (`src/candidates.ts`). Jev never writes a value; it only picks a span.
4. Code assembles the command line. Required arguments that were not found become `<placeholders>`.

## Usage

```sh
pnpm install
cp .env.example .env && chmod 600 .env   # then fill in a key (.env is gitignored)

pnpm nli gh 'マージ済みのプルリクを見る'           # → gh pr list --state merged
pnpm nli gh 'PR 123 をチェックアウト' --explain    # probabilities, latency, tokens
pnpm nli gh 'プルリクを閉じる' --pick              # choose among candidates with fzf
pnpm eval gh                                      # accuracy on eval/gh.jsonl
```

Put it on your PATH with `pnpm link --global`, then source `shell/nli.zsh` and press
`Ctrl-X Ctrl-N` after typing `gh <request>` to replace the line with the suggestion.
