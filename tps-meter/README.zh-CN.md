# tps-meter

[English](README.md) | 简体中文

测 Claude 回答得有多快：每次模型请求的首 token 时间（TTFT）和每秒输出 token 数，写进一个小 JSON 文件，状态栏读出来显示。

```
💬 12 | 🪙 ↑1.2M ↓35K | 💰 $1.2345 | ⚡ 121 tok/s · TTFT 1.1s · 均 129 tok/s
```

Claude Code 传给状态栏的输入里没有模型流式输出的计时，所以这个 mod 挂在 `turn.step`（每次模型请求的流式事件）上，按到达时间给每个分块计时。

## 安装

在终端会话的输入框里：

```
/plugin install tps-meter --marketplace kadaliao/claude-mods
```

或者在 shell 里：

```bash
claude plugin marketplace add kadaliao/claude-mods
claude plugin install tps-meter@kadaliao
```

## 显示到状态栏

每次主会话的模型请求结束后，mod 会写 `~/.claude/tps/<session_id>.json`（设置了 `$CLAUDE_CONFIG_DIR` 时写到 `$CLAUDE_CONFIG_DIR/tps/`）。状态栏命令用 stdin 里拿到的 `session_id` 去读：

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
    (if .avg_tps then "均 \(.avg_tps | round) tok/s" else empty end)
  ] | join(" · ")' "$tps_file")
echo "$(jq -r '.model.display_name' <<<"$input")${speed:+ | $speed}"
```

会话的第一次请求结束前还没有这个文件，上面的脚本就不多显示东西。

## 各字段的含义

| 字段 | 含义 |
| --- | --- |
| `ttft_ms` | 最近一次请求：从发出到收到第一个流事件（网络、排队和 prefill） |
| `output_tokens`、`decode_ms` | 最近一次请求：生成的 token 数，以及从第一个流事件到结束的时间 |
| `tps` | 最近一次请求：`output_tokens / decode_ms`，含思考 token；太短没法算时为 `null` |
| `last_tps` | 最近一个不为 `null` 的 `tps`，状态栏显示这个 |
| `avg_tps` | 本会话输出 token 总数除以总生成时间（按 token 加权） |
| `avg_ttft_ms` | 本会话 TTFT 的平均值 |
| `steps` | 本会话统计到的模型请求数 |
| `model`、`updated_at` | 最近一次请求的模型，以及文件写入时间（毫秒时间戳） |

生成不到 50 个 token、或者流式输出不到 250ms 的请求（比如只发起一次工具调用）几乎是一下子全到的，算出来的速度反映不了模型快慢：它的 `tps` 为 `null`，`last_tps` 保留上一次的值。它仍然计入 `avg_tps`，只是权重很小。

和 Claude Code 自己的数据对过：测到的 TTFT 和 `claude -p --output-format json` 报告的 `ttft_stream_ms` 只差几毫秒，`output_tokens` 一致。

## 限制

- 只统计主会话。subagent 和主会话并行输出，不计入。
- 每个会话在 `~/.claude/tps/` 留一个约 250 字节的文件，不会自动清理。
- mod（function hooks）是 Claude Code 的 early access API，版本之间可能变化。本 mod 在 Claude Code 2.1.296 上开发和测试。如果哪天 mod 加载不了，文件就不再更新，上面的脚本也就不多显示东西。

## 开发

```bash
claude --plugin-dir ~/workspace/claude-mods/tps-meter   # 用工作副本开一个会话
claude plugin validate ~/workspace/claude-mods/tps-meter
claude plugin test ~/workspace/claude-mods/tps-meter
```

许可证：MIT（License: MIT）
