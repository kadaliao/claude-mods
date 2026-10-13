# tps-meter

English | [简体中文](README.zh-CN.md)

Measures how fast Claude answers: time to first token (TTFT) and output tokens per second of every
model request, written to a small JSON file your status line can show.

```
💬 12 | 🪙 ↑1.2M ↓35K | 💰 $1.2345 | ⚡ 121 tok/s · TTFT 1.1s · avg 129 tok/s
```

Claude Code's status line input carries no timing of the model's stream, so this mod hooks
`turn.step`, the streaming event of each model request, and times the chunks as they arrive.

## Install

At the prompt of a terminal session:

```
/plugin install tps-meter --marketplace kadaliao/claude-mods
```

or from a shell:

```bash
claude plugin marketplace add kadaliao/claude-mods
claude plugin install tps-meter@kadaliao
```

## Show it in your status line

After every main-loop model request the mod writes `~/.claude/tps/<session_id>.json`
(`$CLAUDE_CONFIG_DIR/tps/` when that is set). A status line command reads it by the `session_id`
it gets on stdin:

```bash
#!/bin/bash
input=$(cat)
session_id=$(jq -r '.session_id' <<<"$input")
tps_file="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/tps/$session_id.json"
speed=""
[[ -f $tps_file ]] && speed=$(jq -r '
  def dur: if . >= 1000 then "\(. / 100 | round / 10)s" else "\(round)ms" end;
  [ "⚡ \(if .last_tps then .last_tps | round else "-" end) tok/s",
    "TTFT \(.ttft_ms | dur)",
    (if .avg_tps then "avg \(.avg_tps | round) tok/s" else empty end)
  ] | join(" · ")' "$tps_file")
echo "$(jq -r '.model.display_name' <<<"$input")${speed:+ | $speed}"
```

Until the first request of a session ends there is no file, and the snippet shows nothing extra.

## What the numbers mean

| Field | Meaning |
| --- | --- |
| `ttft_ms` | Last request: from the moment it was sent to the first stream event (network, queueing and prefill) |
| `output_tokens`, `decode_ms` | Last request: tokens generated, and the time from the first stream event to the end |
| `tps` | Last request: `output_tokens / decode_ms`, thinking tokens included; `null` when it was too short to say |
| `last_tps` | The latest `tps` that was not `null`: what to show |
| `avg_tps` | The session's output tokens over its total decode time (token-weighted) |
| `avg_ttft_ms` | The session's mean TTFT |
| `steps` | Model requests counted in this session |
| `model`, `updated_at` | Model of the last request, and when the file was written (epoch ms) |

A request that generates fewer than 50 tokens, or streams for less than 250 ms (a lone tool call),
arrives in one burst, so its rate says nothing about the model's speed: its `tps` is `null` and
`last_tps` keeps the previous value. It still counts toward `avg_tps`, where it weighs little.

Checked against Claude Code's own figures: the TTFT it measures is within a few milliseconds of the
`ttft_stream_ms` that `claude -p --output-format json` reports, and `output_tokens` match.

## Limits

- Only the main conversation is measured. Subagents stream in parallel with it, so their requests
  are left out.
- One file per session (about 250 bytes) stays in `~/.claude/tps/`; nothing cleans them up.
- Mods (function hooks) are an early-access API of Claude Code and may change between releases.
  Built and tested on Claude Code 2.1.296. If the mod stops loading, the file stops updating and the
  snippet above shows nothing extra.

## Development

```bash
claude --plugin-dir ~/workspace/claude-mods/tps-meter   # a session with the working copy loaded
claude plugin validate ~/workspace/claude-mods/tps-meter
claude plugin test ~/workspace/claude-mods/tps-meter
```
