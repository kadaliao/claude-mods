# statusline

[English](README.md) | 简体中文

输入框上方的两行彩色状态栏，由 mod 自己绘制：不需要状态栏命令、不需要脚本、不用改设置。

```
✦ Opus 5.5 high   claude-mods ⎇ main ●2 ⇡1   ctx ▰▰▰▱▱▱▱▱▱▱ 31% 62k/200k
↑ 1.2M in  ↓ 35k out   cache 92%   $1.23   121 tok/s avg 129   TTFT 1.1s
```

| 内容 | 含义 |
| --- | --- |
| `✦ Opus 5.5 high` | 当前会话的模型，以及最近一次请求的推理强度（effort） |
| `claude-mods` | 当前目录名 |
| `⎇ main ●2 ⇡1 ⇣0` | git 分支（detached 时显示短 commit）、改动文件数、领先/落后上游的提交数 |
| `ctx ▰▰▰▱▱ 31% 62k/200k` | 上下文窗口占用：最近一次请求的输入占模型窗口的比例。50% 以下绿、80% 以下黄、以上红 |
| `↑ in` / `↓ out` | 本会话所有模型请求（含子代理）读入的 token（输入，含缓存读写）和写出的 token（输出） |
| `cache 92%` | 输入 token 中由 prompt cache 命中的比例 |
| `$1.23` | 按 API 价格计算的本会话费用，与 `/cost` 的总计一致 |
| `tok/s avg` | 主会话最近一次请求的每秒输出 token 数，以及本会话按 token 加权的平均值 |
| `TTFT` | 主会话最近一次请求从发出到收到第一个流式事件的时间（网络、排队和 prefill） |

Claude Code 传给状态栏的输入里没有模型流式输出的计时，所以这个 mod 挂在 `turn.step`（每次模型请求的流式事件）上，按到达时间给每个分块计时。生成不到 50 个 token、或流式不到 250 ms 的请求（比如单个工具调用）是一口气到达的，算不出速度，所以不更新显示的 tok/s，但仍计入平均值。

## 安装

在终端会话的输入框里：

```
/plugin install statusline --marketplace kadaliao/claude-mods
```

或者在 shell 里：

```bash
claude plugin marketplace add kadaliao/claude-mods
claude plugin install statusline@kadaliao
```

下一个会话起生效，或者在已打开的会话里运行 `/reload-plugins`。`ctrl+x ctrl+a`（或旁边的 `[-]`）可以折叠。

如果之前装了 `tps-meter`，它已被这个 mod 取代：`claude plugin uninstall tps-meter@kadaliao`。

## 刷新时机

每次模型请求、斜杠命令和回合结束后重绘，另外每 10 秒刷新一次。git 信息用 `git status --porcelain=2 --branch` 读取，时机是会话开始、每次提交输入、`Bash`/`Edit`/`Write`/`NotebookEdit` 工具调用之后、每个回合结束后，以及 10 秒一次的定时刷新。

## 限制

- token 总数统计的是对话循环（主会话和子代理）发出的模型请求。循环之外的请求（压缩、标题生成、其他插件的 `$.model.complete`）算进了费用，但不算进 token 总数。
- 总数在热重载和恢复会话（resume）后保留（存在插件 store 里，保留最近 50 个会话）。`/clear` 会清零。
- 只在终端和桌面端绘制；有调查问卷时让位给问卷。
- mod（function hooks）是 Claude Code 的 early access API，版本之间可能变化。在 Claude Code 2.1.304 上构建和测试。

## 开发

```bash
claude --plugin-dir ~/workspace/claude-mods/statusline   # 加载工作副本的会话
claude plugin validate ~/workspace/claude-mods/statusline
claude plugin test ~/workspace/claude-mods/statusline
```

许可证：MIT（License: MIT）
