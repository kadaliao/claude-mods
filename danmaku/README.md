# danmaku

English | [简体中文](README.zh-CN.md)

Bilibili-style bullet comments (danmaku) that fly right to left across a side pane while Claude
works, heckling what it does: "前方高能！！" when it runs `rm -rf`, "红了红了" when a test fails,
"这波操作有点东西" when a small model finds the moment worth a quip.

```
┌ 弹幕 ──────────────────────────────────────────┐
│        前排            666                      │
│   又在 grep 了                     前方高能！！ │
│                  这波操作有点东西               │
│ 23 条弹幕 · haiku                               │
└─────────────────────────────────────────────────┘
```

The comments are in Chinese, as on Bilibili.

## Install

At the prompt of a terminal session:

```
/plugin install danmaku --marketplace kadaliao/claude-mods
```

Or from a shell:

```bash
claude plugin marketplace add kadaliao/claude-mods
claude plugin install danmaku@kadaliao
```

Then type `/danmaku` to open the pane.

## Use

| Command | What it does |
| --- | --- |
| `/danmaku` | Opens the pane, or closes it if it is open |
| `/danmaku on` / `/danmaku off` | Opens or closes it |
| `/danmaku <text>` | Sends a comment of your own, bold and underlined |

Whether the pane is on is remembered: a new session opens it again. Opened that way, unasked, it
waits until the terminal is at least 144 columns wide; `/danmaku` opens it at any width. Closing it
with its close mark switches it off.

## How it works

- **Instant reactions.** A table of reactions answers some things at once, with no model call: a
  dangerous command (`rm -rf`, `sudo`, `--force`, `reset --hard`), a test command passing or
  failing, `git push` and `git commit`, a subagent being spawned, the turn starting, ending or
  being interrupted. Frequent things (reads, edits, plain commands) get a reaction only now and then.
- **Model comments.** Each tool call, your prompt, and the end of the turn go into a queue as one
  short line ("Claude 跑命令：npm test（失败了）"). Once three are queued, or three seconds after the
  first, the mod asks the model for one to three comments of at most 15 characters, passing the
  last ten comments so it does not repeat them. One request at a time, and at most one every 4
  seconds (the `density` option: 8s, 4s or 2s).
- **The screen.** Every comment takes about seven seconds to cross the pane, so a longer one moves
  faster, as on Bilibili. A new comment takes the topmost lane where it has room and will not
  catch the one ahead; with no lane free it waits. The pane is redrawn eight times a second while
  anything is on it, and not at all when it is empty.

## Options

| Option | Values | Default |
| --- | --- | --- |
| `model` | `haiku`, `sonnet` | `haiku` |
| `density` | `low` (a request every 8s at most), `normal` (4s), `high` (2s) | `normal` |

Set them in `/config`, or in `~/.claude/settings.json` under `pluginConfigs.danmaku`.

## Limits

- What goes to the model: the first 80 characters of your prompt, the first 60 of each command,
  file names (not their contents), search patterns, and the first 120 characters of Claude's
  answer. It is sent on the session's own credentials, like any of Claude Code's requests, and
  billed to them. With `haiku` and the default density it is a small amount; no request is made
  while the pane is off or not shown.
- Comments are about what happened, not always funny, and sometimes repeat.
- Drawn on the terminal and the desktop app. Mods (function hooks) are an early-access API of
  Claude Code and may change between releases. Built and tested on Claude Code 2.1.310.

## Development

```bash
claude --plugin-dir ~/workspace/claude-mods/danmaku   # a session that loads the working copy
claude plugin validate ~/workspace/claude-mods/danmaku
claude plugin test ~/workspace/claude-mods/danmaku
```

License: MIT
