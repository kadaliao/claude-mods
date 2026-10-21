# statusline

English | [简体中文](README.zh-CN.md)

A two-row, colored status band above the prompt, drawn by the mod itself: no status line command,
no script, no settings to edit.

```
✦ Opus 5.5 high   claude-mods ⎇ main ●2 ⇡1   ctx ▰▰▰▱▱▱▱▱▱▱ 31% 62k/200k
↑ 1.2M in  ↓ 35k out   cache 92%   $1.23   121 tok/s avg 129   TTFT 1.1s
```

| Figure | What it is |
| --- | --- |
| `✦ Opus 5.5 high` | The session's model, and the reasoning effort of the latest request |
| `claude-mods` | The session's folder |
| `⎇ main ●2 ⇡1 ⇣0` | Git branch (the short commit when detached), changed files, commits ahead of and behind upstream |
| `ctx ▰▰▰▱▱ 31% 62k/200k` | Context window in use: the latest request's input against the model's window. Green under 50%, yellow under 80%, red above |
| `↑ in` / `↓ out` | Tokens read (input, cache reads and writes included) and written (output) by every model request of the session, subagents included |
| `cache 92%` | Share of those input tokens served from the prompt cache |
| `$1.23` | The session's cost at API prices, as `/cost` totals it |
| `tok/s avg` | Output tokens/s of the latest main-loop request, and the session's token-weighted average |
| `TTFT` | Latest main-loop request: from sending it to its first stream event (network, queueing and prefill) |

Claude Code's own status line input carries no timing of the model's stream, so the mod hooks
`turn.step`, the streaming event of each model request, and times the chunks as they arrive. A
request that generates fewer than 50 tokens or streams for less than 250 ms (a lone tool call)
arrives in one burst, so it leaves the shown tok/s alone; it still counts toward the average.

## Install

At the prompt of a terminal session:

```
/plugin install statusline --marketplace kadaliao/claude-mods
```

or from a shell:

```bash
claude plugin marketplace add kadaliao/claude-mods
claude plugin install statusline@kadaliao
```

The band shows from the next session, or after `/reload-plugins`. `ctrl+x ctrl+a` (or the `[-]`
beside it) collapses it.

If you had `tps-meter` installed, it is replaced by this mod: `claude plugin uninstall tps-meter@kadaliao`.

## How it refreshes

The band redraws after every model request, slash command and turn, and every 10 seconds. Git is
read with `git status --porcelain=2 --branch` on session start, on each prompt, after `Bash`,
`Edit`, `Write` and `NotebookEdit` tool calls, after each turn, and on the 10-second tick.

## Limits

- Token totals count model requests made through the conversation loop (main and subagents).
  Requests made outside it (compaction, title generation, other plugins' `$.model.complete`) are in
  the cost but not in the token totals.
- Totals survive a hot reload and a resumed session (kept in the plugin store, the latest 50
  sessions). `/clear` starts them over.
- The band is drawn on the terminal and desktop surfaces; a survey takes its place while it shows.
- Mods (function hooks) are an early-access API of Claude Code and may change between releases.
  Built and tested on Claude Code 2.1.304.

## Development

```bash
claude --plugin-dir ~/workspace/claude-mods/statusline   # a session with the working copy loaded
claude plugin validate ~/workspace/claude-mods/statusline
claude plugin test ~/workspace/claude-mods/statusline
```

License: MIT
