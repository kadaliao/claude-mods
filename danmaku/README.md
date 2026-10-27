# danmaku

English | [简体中文](README.zh-CN.md)

Bilibili-style bullet comments (danmaku) that fly right to left across a few lanes above the prompt
while Claude works, heckling what it does: "前方高能！！" when it runs `rm -rf`, "红了红了" when a
test fails, "这波操作有点东西" when a small model finds the moment worth a quip.

```
        前排            666
   又在 grep 了                     前方高能！！
                 这波操作有点东西
> _
```

The lanes take three rows, only while Claude works and for about 12 seconds after the last
comment; then they fold away and the prompt has its room back. If another mod draws above the
prompt too (the [statusline](../statusline/) band, say), the lanes go above it. statusline
before 0.1.1 takes that space whole and hides the lanes: update it, and `/danmaku` tells you
when something is in the way.

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

Then type `/danmaku` to switch it on.

## Use

| Command | What it does |
| --- | --- |
| `/danmaku` | Switches it on (one comment flies by to show where), or off if it is on |
| `/danmaku on` / `/danmaku off` | Switches it on or off |
| `/danmaku <text>` | Sends a comment of your own, bold and underlined |

Whether it is on is remembered: a new session starts with it on again. `ctrl+x ctrl+a` (or the
`[-]` beside the band) collapses everything drawn above the prompt.

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
- **The lanes.** Every comment takes about nine seconds to cross, so a longer one moves faster, as
  on Bilibili. A new comment takes the topmost lane where it has room and will not catch the one
  ahead; with no lane free it waits. The lanes move on the terminal's own frame clock, ten frames a
  second, so the rest of the band is not redrawn for each frame.

## Options

| Option | Values | Default |
| --- | --- | --- |
| `model` | `haiku`, `sonnet` | `haiku` |
| `density` | `low` (a request every 8s at most), `normal` (4s), `high` (2s) | `normal` |
| `lanes` | `2`, `3`, `4`: rows the comments fly in | `3` |

Set them in `/config`, or in `~/.claude/settings.json` under `pluginConfigs.danmaku`. In a short
terminal the lanes give way: they keep three rows of the band for other mods, and leave out a lane
rather than push those off.

## Limits

- What goes to the model: the first 80 characters of your prompt, the first 60 of each command,
  file names (not their contents), search patterns, and the first 120 characters of Claude's
  answer. It is sent on the session's own credentials, like any of Claude Code's requests, and
  billed to them. With `haiku` and the default density it is a small amount; no request is made
  while it is off, or where nothing draws the band (a `claude -p` run).
- Comments are about what happened, not always funny, and sometimes repeat.
- Drawn on the terminal and the desktop app; a survey takes the band while it shows. Mods
  (function hooks) are an early-access API of Claude Code and may change between releases. Built
  and tested on Claude Code 2.1.310.
- Version 0.1 drew in a side pane. Updating closes that pane.

## Development

```bash
claude --plugin-dir ~/workspace/claude-mods/danmaku   # a session that loads the working copy
claude plugin validate ~/workspace/claude-mods/danmaku
claude plugin test ~/workspace/claude-mods/danmaku
```

License: MIT
