# peek

[English](README.md) | 简体中文

看到 Claude 看到的图。Claude 读图片文件、截图（Claude in Chrome、内置浏览器、computer use，以及任何返回图片的 MCP 工具）时，图直接画在对话里那一行下面，不再只是一行 `Read image (142KB)`。

```
⏺ Read(docs/screenshot.png)
  ⎿  Read image (142.3KB)
     ┌────────────────────────────┐
     │           那张图            │
     └────────────────────────────┘
```

## 安装

在终端会话的输入框里：

```
/plugin install peek --marketplace kadaliao/claude-mods
```

或者在 shell 里：

```bash
claude plugin marketplace add kadaliao/claude-mods
claude plugin install peek@kadaliao
```

装好后不用输入任何命令，Claude 读到的下一张图就会出现在那一行下面。

## 用法

- **一张图**：在返回它的那一行下面画一张缩略图，大约 8 行高。
- **几次 Read 折叠成一行**（"Read 3 files"）：缩略图并排画在这一行下面，最多 12 张。
- **ctrl+o**：展开的对话里每张图都画成大图，最高 30 行，占满宽度。

## 原图还是色块

终端能画图片时，peek 画原图：kitty、Ghostty、全屏模式（`/tui fullscreen`）下的 iTerm2 3.5 及以上，以及在这些终端里运行、开了 `allow-passthrough` 和 `focus-events` 的 tmux 3.3 及以上。其他终端画彩色色块（一个字符两个像素），看得出布局和颜色，看不清字。

是哪一种，peek 在每个会话的第一张图时自己判断。有些终端能画图片，但 Claude Code 不认识它（比如 herdr 这类终端复用器）。这时第一张图下面会多一行：

```
看原图：用 CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1 启动 Claude Code
```

照着做（`CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1 claude`）就能看到原图。

## 选项

| 选项 | 取值 | 默认 |
| --- | --- | --- |
| `size` | `small`（约 8 行）、`large`（最高 16 行，占满宽度） | `small` |
| `picture` | `auto`、`image`（总是用终端的图片功能）、`blocks`（总是用色块） | `auto` |

在 `/plugin` 里设置，或者写在 `~/.claude/settings.json` 的 `pluginConfigs.peek` 下。

## 原理

- 对话的每一行在保存前都会经过 mod。工具结果里的图记在那次工具调用下，画那一行时从这里取。恢复会话时从对话记录里重新读出来。
- mod 没有图片库，所以 peek 自带解码器：PNG（自带解压）和 JPEG（[jpeg-js](https://github.com/jpeg-js/jpeg-js) 的解码器，源自 pdf.js）。同一张图同一尺寸只解码一次。
- 不发送任何数据，也不调用模型。

## 限制

- WebP 和 GIF 不画，原地显示一行说明。
- 每个会话保留最近 100 张图的数据，更早的那一行会说明已经释放。
- 非全屏模式下，已经打印到终端的行不会再变。在画不了图片的终端里，第一张图可能停留在一行 `[图片 …]` 文字，因为换成色块要晚一秒。
- 只在终端里画。mod（function hooks）是 Claude Code 的早期接口，版本之间可能变化。在 Claude Code 2.1.319 上开发和测试。

## 开发

```bash
claude --plugin-dir ~/workspace/claude-mods/peek   # 加载工作副本的会话
claude plugin validate ~/workspace/claude-mods/peek
claude plugin test ~/workspace/claude-mods/peek
```

许可证：MIT。`hooks/jpeg.ts` 保留了 jpeg-js（BSD-3-Clause）和 pdf.js（Apache-2.0）的版权声明。
