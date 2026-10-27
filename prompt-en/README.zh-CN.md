# prompt-en

[English](README.md) | 简体中文

你发的每条 prompt 下方会多一行英文。它跟着对话滚动，不在屏幕上常驻占位。

**用其他语言写的 prompt**，显示英文译文：

```
> 我想要创建一个 mod，把我本轮的 prompt 翻译成英文。它要考虑显示的美观和空间。
  EN  I want to build a mod that translates my prompt for each turn into English. It should
      account for display aesthetics and screen space.
```

**用英文写的 prompt**，帮你纠错或润色：写错了或说法不地道，就给出改正后的句子，改动的词标绿，并附上原因；无可挑剔的话，给两种别的说法。

```
> please help me check why the build is failed
  EN ✎  please help me check why the build failed · remove "is": "failed" is intransitive here

> Could you make this function async?
  EN ✓  also Make this function async. · Would you mind making this function async?
```

黄色 `✎` 表示有错误，蓝色 `✎` 表示没有错但母语者会换个说法，`✓` 表示写得很自然。聊天里的随意写法（全小写、句末不加句号、"fixed it" 这种省略主语的说法）不算错。

## 长 prompt

长 prompt 只给简短的结果，不逐句处理：

- **粘贴的材料先在本地折叠，不发给模型。** 代码块，以及没有代码围栏、但看起来是代码的大段内容（如果 prompt 是中文等其他语言，还包括不含这些文字的大段内容，比如英文日志或文档），各自换成一个标签，比如 `[TypeScript code, 60 lines]`。粘贴五万字，请求里和屏幕上都只剩几个词。
- **用其他语言写得长的，给精简版。** 超过约 120 个英文词（大约 300 个汉字）时，改成第一人称、最多 4 句的精简版：所有要求、问题和约束都保留，背景和重复的部分去掉。行末有一个灰色的 `· gist of 2.5k chars`。
- **英文写得长的，只列关键改动。** 超过约 60 个词时，不再整段重写，最多列出 5 处改动（`"should be add" → "should add" · "it help me" → "it helps me" · …`）。
- **终端里最多占 6 行**，按 `ctrl+o` 展开对话记录可以看全部。

```
> 下面是 statusline 的代码，帮我看看为什么 git 分支有时候不刷新：```ts …60 行…``` 背景是这样的：…
  EN  Here's my statusline code, and I need help figuring out why the git branch sometimes
      fails to refresh. … Please don't change the external interface, and don't add any new
      dependencies. [TypeScript code, 60 lines] · gist of 2.5k chars
```

不到 3 个英文词的 prompt（`ok`、`commit it`）、斜杠命令、后台任务通知、其他会话发来的消息都不处理。

## 生词本

prompt 下方那行英文教过你的东西，会收进生词本：

- **英文被纠正或润色过**，收一张「你写的 → 更地道的」卡片：`add timeout → add a timeout（article）`。同样的错再犯一次，这张卡片退回从头复习。
- **中文 prompt 的译文**，由小模型挑出最多两个值得学的表达：`顺便 → while you're at it`、`兜底 → fall back to`、`过度设计 → over-engineered`。日常词、技术术语、代码都跳过；挑出来的词必须在你的原文和译文里都找得到才收，不会收进编造的内容。

`/vocab` 打开一个面板，一张一张复习到期的卡片：

```
生词本  1 / 3 · 共 18 条

你写的  add timeout
原句    Make this function async and add timeout

f: 显示答案   Esc 关闭
```

按 `f` 显示答案，然后 `1` 忘了、`2` 模糊、`3` 记得（回车就是记得），`x` 删掉这张。记得的卡片每次隔得更久（1、3、7、16、35 天，最后 90 天）；忘了的在这一轮最后再出一次，并从头开始。一轮最多 20 张。有到期卡片时，开新会话会弹一条提示，一天最多两次。`/vocab list` 列出最近收的卡片和每张的熟练度。

## 安装

在终端会话的输入框里：

```
/plugin install prompt-en --marketplace kadaliao/claude-mods
```

或者在 shell 里：

```bash
claude plugin marketplace add kadaliao/claude-mods
claude plugin install prompt-en@kadaliao
```

下一个会话起生效，或者在已打开的会话里运行 `/reload-plugins`。

## 用法

| | |
| --- | --- |
| `/prompt-en` | 开关这个 mod（`/prompt-en on`、`/prompt-en off`），跨会话记住 |
| `model` 选项 | 默认 `haiku`，可以改成 `sonnet` 或 `opus` |
| `reviewEnglish` 选项 | 默认 `true`；设为 `false` 后只保留翻译，不再纠错英文 |
| `/vocab` | 在面板里复习生词本里到期的卡片；`/vocab list` 列出最近收的 |
| `collectVocab` 选项 | 默认 `true`；设为 `false` 后不再往生词本里收，也不再多发那次请求 |

选项在插件选项（`/config`）里设置。

## 原理

在 `prompt.submit` 时，先去掉宿主只写给模型看的 `<system-reminder>` 块（比如桌面应用在未选文件夹的会话里，会在第一条 prompt 前面加一段），再把粘贴的内容折叠，看剩下你自己写的文字：含有拉丁字母以外的字母就翻译；有 3 个以上英文词就纠错。然后发一次 `$.model.complete` 请求，不等它返回，prompt 照常立即提交。`UserMessage` 的渲染钩子先画引擎原本的那一行，再在下面画英文：请求进行中显示 `translating…` 或 `reviewing…`，完成后显示结果。纠错时标绿的词，是把改正版和你的原文逐词对比找出来的。

mod 写的内容都不会发给对话所用的模型，模型读到的仍是你写的原文。

## 限制

- 每条需要处理的 prompt 发一次模型请求，和其他请求一样计费（Haiku，低 effort）。同样的文字只处理一次：结果存在插件 store 里（保留最近 300 条），所以恢复会话（resume）后还会显示，重复输入 `继续` 不再花钱。
- 开着生词本时，每条译文多发一次小请求来挑短语（很短的 prompt 跳过）；纠错不额外花钱。
- 生词本存在本机的插件 store 里，最多 1000 张；超出后最熟的老卡片先删。
- 你自己写的文字最多发送 6000 个字符，超出部分只处理开头。
- 请求失败时留一行灰字 `no translation (overloaded)` 或 `no review (…)`，不自动重试；再次提交同样的文字会重试。
- 按文字系统判断语言：法语、西班牙语的 prompt 会被当作英文来纠错。
- mod（function hooks）是 Claude Code 的 early access API，版本之间可能变化。在 Claude Code 2.1.308 上构建和测试。

## 开发

```bash
claude --plugin-dir ~/workspace/claude-mods/prompt-en   # 加载工作副本的会话
claude plugin validate ~/workspace/claude-mods/prompt-en
claude plugin test ~/workspace/claude-mods/prompt-en
```

许可证：MIT（License: MIT）
