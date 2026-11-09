# peek

[English](README.md) | 简体中文

看到 Claude 看到的图。Claude 读图片文件、截图（Claude in Chrome、内置浏览器、computer use，以及任何返回图片的 MCP 工具）时，图直接画在对话里那一行下面，不再只是一行 `Read image (142KB)`。你粘贴进消息的图也一样，画在你那条消息下面。

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

- **一张图**：在返回它的那一行下面画一张缩略图，大约 5 行高。
- **粘贴的图**：画在你那条消息下面，大小和上面一样。
- **几次 Read 折叠成一行**（"Read 3 files"）：缩略图并排画在这一行下面，每张 4 行高，最多 12 张。
- **ctrl+o**：展开的对话里每张图都画成大图，最高 30 行，占满宽度。开着 verbose（`/config` 里的 Verbose output）时，每一行本来就是展开的，peek 分不出 ctrl+o，图一律按 `size` 选项的大小画。

## 终端

图用的是终端自己的图片功能：kitty、Ghostty、全屏模式（`/tui fullscreen`）下的 iTerm2 3.5 及以上，以及在这些终端里运行、开了 `allow-passthrough` 和 `focus-events` 的 tmux 3.3 及以上。其他终端里 peek 什么都不加，对话照 Claude Code 原样显示。

能不能画，peek 在每个会话的第一张图时自己判断。Claude Code 只对认识的终端打开图片功能；遇到不认识的终端，peek 在第一张图那一行下面说一次该怎么办，同一个终端以后不再重复：

- 能画 kitty 图片、但 Claude Code 不认识的终端（比如 herdr 这类终端复用器）：在 Claude Code 启动前设好 `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1`。一劳永逸的办法是写进 `~/.claude/settings.json`：

  ```json
  { "env": { "CLAUDE_CODE_FORCE_TERMINAL_IMAGES": "1" } }
  ```

  只对一次会话生效的办法是 `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1 claude`。写进 settings 后，Claude Code 在所有终端里都会按能画图处理，所以只在你用的终端都支持 kitty 图片时这样设。mod 没法替你设：Claude Code 在任何 mod 运行之前就已经决定了。
- iTerm2：要在全屏模式下才能显示图片，输入 `/tui fullscreen`。
- tmux：按 Claude Code 给出的要求设置（tmux 3.3 及以上，打开 `allow-passthrough` 和 `focus-events`）。

## 选项

| 选项 | 取值 | 默认 |
| --- | --- | --- |
| `size` | `small`（约 5 行）、`large`（最高 16 行，占满宽度） | `small` |

在 `/plugin` 里设置，或者写在 `~/.claude/settings.json` 的 `pluginConfigs.peek` 下。

## 原理

- 对话的每一行在保存前都会经过 mod。工具结果里的图记在那次工具调用下，粘贴的图记在那条消息下，画那一行时从这里取。恢复会话时从对话记录里重新读出来；粘贴的图靠消息里的 `[Image #1]` 文字找回对应的那一行。
- mod 没有图片库，所以 peek 自带解码器：PNG（自带解压）和 JPEG（[jpeg-js](https://github.com/jpeg-js/jpeg-js) 的解码器，源自 pdf.js）。比显示框大的图先缩小再交给终端，同一张图同一尺寸只处理一次。
- 不发送任何数据，也不调用模型。

## 限制

- WebP 和 GIF 不画，原地显示一行说明。
- 每个会话保留最近 100 张图的数据，更早的那一行会说明已经释放。
- 非全屏模式下，已经打印到终端的行不会再变。在画不了图片的终端里，第一张图可能停留在一行 `[图片 …]` 文字，因为判断要一秒。
- 只在终端里画。mod（function hooks）是 Claude Code 的早期接口，版本之间可能变化。在 Claude Code 2.1.319 上开发和测试。

## 开发

```bash
claude --plugin-dir ~/workspace/claude-mods/peek   # 加载工作副本的会话
claude plugin validate ~/workspace/claude-mods/peek
claude plugin test ~/workspace/claude-mods/peek
```

许可证：MIT。`hooks/jpeg.ts` 保留了 jpeg-js（BSD-3-Clause）和 pdf.js（Apache-2.0）的版权声明。
