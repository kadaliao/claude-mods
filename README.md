# claude-mods

English | [简体中文](README.zh-CN.md)

Mods for [Claude Code](https://code.claude.com): plugins of function hooks that change Claude Code's
own interface and behaviour. Each mod lives in its own directory with its own
`.claude-plugin/plugin.json`, and the repository is a plugin marketplace named `kadaliao`, so each
mod installs separately.

| Mod | What it does | Install |
| --- | --- | --- |
| [statusline](statusline/) | A two-row status band above the prompt: model, folder, git branch, context window, tokens in/out, cache rate, API cost, tokens/s and TTFT | `/plugin install statusline --marketplace kadaliao/claude-mods` |
| [prompt-en](prompt-en/) | English under each prompt: a translation when you write in another language, corrections or other ways to say it when you write in English; long prompts condensed, pasted code folded | `/plugin install prompt-en --marketplace kadaliao/claude-mods` |
| [danmaku](danmaku/) | Bilibili-style bullet comments (danmaku) flying across a side pane, heckling what Claude does as it works: instant reactions to a `rm -rf` or a failing test, and quips a small model writes every few seconds | `/plugin install danmaku --marketplace kadaliao/claude-mods` |
| [ambience](ambience/) | Sounds for what Claude does (a command's click, an edit's pop, a fanfare when tests pass, a sad trombone when they fail, a chime when the turn ends), a notification after a long turn, and a live tally of the turn's work under the prompt | `/plugin install ambience --marketplace kadaliao/claude-mods` |

The install line is typed at the prompt of a Claude Code terminal session. From a shell:

```bash
claude plugin marketplace add kadaliao/claude-mods
claude plugin install <mod>@kadaliao
```

Each directory's README covers what the mod does, how it works, and its limits. Mods are an
early-access API of Claude Code and may change between releases.

## Updating

An installed mod runs the copy made when it was installed. To pick up new commits:

```bash
claude plugin marketplace update kadaliao
claude plugin update <mod>@kadaliao
```

then run `/reload-plugins` in an open session, or start a new one.

## Local development

```bash
git clone git@github.com:kadaliao/claude-mods.git ~/workspace/claude-mods
claude --plugin-dir ~/workspace/claude-mods/statusline
```

`--plugin-dir` loads the working copy for that session and reloads it as you save. Uninstall the
GitHub copy first (`claude plugin uninstall <mod>@kadaliao`) if both should not run at once.

License: MIT
