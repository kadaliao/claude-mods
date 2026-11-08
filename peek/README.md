# peek

English | [简体中文](README.zh-CN.md)

See the pictures Claude looks at. When Claude reads an image file, or takes a screenshot (Claude
in Chrome, the built-in browser, computer use, any MCP tool that returns a picture), the picture
is drawn under that row of the conversation, so you see what Claude sees instead of a line that
says `Read image (142KB)`.

```
⏺ Read(docs/screenshot.png)
  ⎿  Read image (142.3KB)
     ┌────────────────────────────┐
     │        the picture         │
     └────────────────────────────┘
```

## Install

At the prompt of a terminal session:

```
/plugin install peek --marketplace kadaliao/claude-mods
```

Or from a shell:

```bash
claude plugin marketplace add kadaliao/claude-mods
claude plugin install peek@kadaliao
```

There is nothing to type after that: the next picture Claude reads shows up under its row.

## Use

- **One picture**: a thumbnail about 5 rows tall under the row that returned it.
- **Several Reads folded into one line** ("Read 3 files"): their thumbnails side by side under
  that line, 4 rows each, up to 12.
- **ctrl+o**: the expanded transcript draws every picture large, up to 30 rows and the full width.

## Terminals

The pictures are the terminal's own: kitty, Ghostty, iTerm2 3.5 or later under fullscreen
rendering (`/tui fullscreen`), and tmux 3.3 or later in one of those, with `allow-passthrough`
and `focus-events` on. On any other terminal peek adds nothing, and the rows stay as Claude Code
draws them.

It finds out by itself, on the first picture of a session. Claude Code turns pictures on only for
terminals it recognises; on one it does not, peek says once, under the first picture's row, what
to do there, and not again on that terminal:

- A terminal that draws kitty pictures but goes unrecognised (a terminal multiplexer such as
  herdr, say): set `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` before Claude Code starts. Once for good,
  in `~/.claude/settings.json`:

  ```json
  { "env": { "CLAUDE_CODE_FORCE_TERMINAL_IMAGES": "1" } }
  ```

  or for one session, `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1 claude`. It applies to every terminal
  Claude Code then runs in, so set it in settings only where they all draw kitty pictures. A mod
  cannot set it for you: Claude Code decides before any mod runs.
- iTerm2: pictures need fullscreen rendering, `/tui fullscreen`.
- tmux: what Claude Code says tmux needs (`allow-passthrough` and `focus-events` on, tmux 3.3 or
  later).

## Options

| Option | Values | Default |
| --- | --- | --- |
| `size` | `small` (about 5 rows), `large` (up to 16 rows, the full width) | `small` |

Set it in `/plugin`, or in `~/.claude/settings.json` under `pluginConfigs.peek`.

## How it works

- Each row of the conversation passes the mod before it is kept. Pictures in a tool's result are
  filed under that tool call, and the row's drawing reads them from there. A resumed session reads
  them back from the conversation.
- A mod has no image library, so peek carries its own decoders: PNG (with its own inflate) and
  JPEG (the decoder of [jpeg-js](https://github.com/jpeg-js/jpeg-js), from pdf.js). A picture
  larger than its box is shrunk before it goes to the terminal, once per size it is drawn at.
- Nothing leaves your machine and no model is called.

## Limits

- WebP and GIF pictures are not drawn: a line says so in their place.
- The bytes of the last 100 pictures of a session are kept; an older row says it let them go.
- Outside fullscreen, rows already printed to the terminal stay as they were drawn. On a terminal
  that draws no pictures, the first picture can stay as a `[图片 …]` line, as the check takes a
  second.
- Drawn on the terminal only. Mods (function hooks) are an early-access API of Claude Code and may
  change between releases. Built and tested on Claude Code 2.1.319.

## Development

```bash
claude --plugin-dir ~/workspace/claude-mods/peek   # a session that loads the working copy
claude plugin validate ~/workspace/claude-mods/peek
claude plugin test ~/workspace/claude-mods/peek
```

License: MIT. `hooks/jpeg.ts` keeps the notices of jpeg-js (BSD-3-Clause) and pdf.js (Apache-2.0).
