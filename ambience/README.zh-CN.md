# ambience

[English](README.md) | 简体中文

给 Claude 的动作配上音效，长任务结束时发系统通知，并在输入框下方的状态行实时显示本轮战报：

```
⚔ 本轮  ✎ 3 文件 +120 −30 · ⚡ 8 命令 1✗ · 📖 12 · ⏱ 1m05s
```

| 声音 | 什么时候响 |
| --- | --- |
| 咔哒 | 开始跑命令（Bash） |
| 啵 | Edit、Write 或 NotebookEdit 改了文件 |
| 号角 | 测试命令通过（`npm test`、`pytest`、`go test`、`cargo test`、`vitest`、`jest` 等） |
| 悲伤长号 | 测试失败、改文件失败、其他工具报错，或整轮因错误结束 |
| 上行两个音 | `git commit` 成功 |
| 铃声 | 一轮正常结束 |

音效由 `scripts/make-sounds.py` 合成（只用 Python 标准库），放在 `sounds/` 目录。只有主会话的工具调用会出声；子代理的调用计入战报，但不出声。Bash 命令返回非零（比如 `grep` 没搜到）太常见，不出声。

## 安装

在终端会话的输入框里：

```
/plugin install ambience --marketplace kadaliao/claude-mods
```

或者在 shell 里：

```bash
claude plugin marketplace add kadaliao/claude-mods
claude plugin install ambience@kadaliao
```

输入 `/ambience demo` 可以把所有音效挨个听一遍。

## 战报

| 部分 | 统计的是 |
| --- | --- |
| `⚔ 本轮` / `🏁 上轮` | 进行中的这一轮 / 刚结束的上一轮 |
| `✎ 3 文件 +120 −30` | Edit、Write、NotebookEdit 改过的文件数，以及补丁里增删的行数（新建的文件全部算新增） |
| `⚡ 8 命令 1✗` | 跑过的 Bash 命令数，以及报错的工具调用数 |
| `📖 12` | Read、Grep、Glob 的调用次数 |
| `⏱ 1m05s` | 这一轮跑了多久，每秒刷新 |

数到 0 的部分不显示。战报在输入框下方的状态行里，不占 [statusline](../statusline/) 画在输入框上方的那条横条，也不重复 statusline 已经显示的 token 和费用。

## 命令

| 命令 | 作用 |
| --- | --- |
| `/ambience` | 显示当前设置 |
| `/ambience mute` / `unmute` | 关掉 / 打开声音 |
| `/ambience report off` / `report on` | 隐藏 / 显示战报 |
| `/ambience demo` | 所有音效各放一遍 |

静音和战报开关会跨会话记住。

## 选项

| 选项 | 取值 | 默认 |
| --- | --- | --- |
| `volume` | `low`、`normal`、`high` | `normal` |
| `notifyAfter` | `30`、`60`、`120`、`300` 秒，或 `off` | `60` |

一轮跑了至少 `notifyAfter` 秒、并且正常给出回答时，结束时发一条系统通知，内容是战报和回答的前 60 个字。通知走你自己设置的通知渠道（`/config` → 通知），通知关着就不会发。选项在 `/config` 里改，或者写在 `~/.claude/settings.json` 的 `pluginConfigs.ambience` 下。

## 限制

- Claude Code 用 `afplay` 播放 mod 的声音，所以只有 macOS 会响；战报和通知在哪儿都能用。
- 并行的工具调用可能几乎同时结束。同一个音效 120 ms 内只放一次（咔哒是 300 ms），所以连续改好几个文件只会"啵"一声。
- mod（function hooks）是 Claude Code 的 early access API，版本之间可能变化。在 Claude Code 2.1.310 上构建和测试。

## 开发

```bash
python3 -I ~/workspace/claude-mods/ambience/scripts/make-sounds.py   # 重新生成 sounds/
claude --plugin-dir ~/workspace/claude-mods/ambience
claude plugin validate ~/workspace/claude-mods/ambience
claude plugin test ~/workspace/claude-mods/ambience
```

许可证：MIT（License: MIT）
