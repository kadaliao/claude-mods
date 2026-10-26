# ambience

English | [简体中文](README.zh-CN.md)

Sounds for what Claude does, a notification when a long turn ends, and a live tally of the turn's
work in the status line under the prompt:

```
⚔ 本轮  ✎ 3 文件 +120 −30 · ⚡ 8 命令 1✗ · 📖 12 · ⏱ 1m05s
```

| Sound | When |
| --- | --- |
| click | A command starts (Bash) |
| pop | Edit, Write or NotebookEdit changes a file |
| fanfare | A test command passes (`npm test`, `pytest`, `go test`, `cargo test`, `vitest`, `jest`, ...) |
| sad trombone | A test command fails, an edit fails, another tool errors, or the turn ends in an error |
| two notes up | `git commit` succeeds |
| chime | The turn ends with an answer |

The sounds are synthesized by `scripts/make-sounds.py` (Python standard library only) and ship in
`sounds/`. Only the main conversation's calls make a sound; a subagent's are counted in the tally
and kept quiet. A Bash command that exits non-zero (a `grep` with no match) is too common to sound.

## Install

At the prompt of a terminal session:

```
/plugin install ambience --marketplace kadaliao/claude-mods
```

Or from a shell:

```bash
claude plugin marketplace add kadaliao/claude-mods
claude plugin install ambience@kadaliao
```

Type `/ambience demo` to hear every sound once.

## The tally

| Part | What it counts |
| --- | --- |
| `⚔ 本轮` / `🏁 上轮` | This turn, while it runs / the last one, once it ended |
| `✎ 3 文件 +120 −30` | Files changed by Edit, Write and NotebookEdit, and the lines their patches added and removed (a new file's lines count as added) |
| `⚡ 8 命令 1✗` | Bash commands run, and tool calls that ended in an error |
| `📖 12` | Read, Grep and Glob calls |
| `⏱ 1m05s` | How long the turn has run, ticking every second |

A part with nothing to count is left out. It sits in the status line under the prompt, so it does
not take the band above the prompt that [statusline](../statusline/) draws, and it leaves out what
statusline already shows (tokens and cost).

## Commands

| Command | What it does |
| --- | --- |
| `/ambience` | Shows the settings |
| `/ambience mute` / `unmute` | Turns the sounds off or on |
| `/ambience report off` / `report on` | Hides or shows the tally |
| `/ambience demo` | Plays every sound once |

Mute and the tally's switch are remembered across sessions.

## Options

| Option | Values | Default |
| --- | --- | --- |
| `volume` | `low`, `normal`, `high` | `normal` |
| `notifyAfter` | `30`, `60`, `120`, `300` seconds, or `off` | `60` |

A turn that ran at least `notifyAfter` seconds sends a system notification when it ends with an
answer: the tally and the answer's first 60 characters. It goes by your own notification channel
(`/config` → notifications), so with notifications off nothing is sent. Set the options in
`/config`, or in `~/.claude/settings.json` under `pluginConfigs.ambience`.

## Limits

- Claude Code plays a mod's sounds with `afplay`, so they play on macOS only; the tally and the
  notification work everywhere.
- Tool calls run in parallel can end close together; the same sound plays at most once in 120 ms
  (a click once in 300 ms), so a burst of edits pops once.
- Mods (function hooks) are an early-access API of Claude Code and may change between releases.
  Built and tested on Claude Code 2.1.310.

## Development

```bash
python3 -I ~/workspace/claude-mods/ambience/scripts/make-sounds.py   # rewrite sounds/
claude --plugin-dir ~/workspace/claude-mods/ambience
claude plugin validate ~/workspace/claude-mods/ambience
claude plugin test ~/workspace/claude-mods/ambience
```

License: MIT
