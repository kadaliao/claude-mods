# claude-mods

English | [简体中文](README.zh-CN.md)

Mods for [Claude Code](https://code.claude.com): plugins of function hooks that change Claude Code's
own interface and behaviour. Each mod lives in its own directory with its own
`.claude-plugin/plugin.json`, and the repository is a plugin marketplace named `kadaliao`, so each
mod installs separately.

| Mod | What it does |
| --- | --- |
| [statusline](statusline/) | A two-row status band above the prompt: model, folder, git branch, context window, tokens in/out, cache rate, API cost, tokens/s and TTFT<br><img src="docs/statusline/statusline-band.png" width="600" alt="statusline: the two-row band above the prompt"> |
| [prompt-en](prompt-en/) | English under each prompt: a translation when you write in another language, corrections or other ways to say it when you write in English; long prompts condensed, pasted code folded; a vocabulary book (`/vocab`) to review what it taught. Or all of it in Japanese<br><img src="docs/prompt-en/thumb.png" width="684" alt="prompt-en: a Chinese prompt and its English underneath"> |
| [danmaku](danmaku/) | Bilibili-style bullet comments (danmaku) flying in a few lanes above the prompt while Claude works, heckling what it does: instant reactions to a `rm -rf` or a failing test, and quips a small model writes every few seconds<br><img src="docs/danmaku/danmaku-lanes.gif" width="600" alt="danmaku: comments flying above the prompt while Claude works"> |
| [ambience](ambience/) | Sounds for what Claude does (a command's click, an edit's pop, a fanfare when tests pass, a sad trombone when they fail, a chime when the turn ends), a notification after a long turn, and a live tally of the turn's work under the prompt<br><img src="docs/ambience/ambience-tally.png" width="600" alt="ambience: the turn's tally under the prompt"> |

To install one, type this at the prompt of a Claude Code terminal session:

```
/plugin install <mod> --marketplace kadaliao/claude-mods
```

Or from a shell:

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

Auto-update is off for a third-party marketplace until you turn it on: in `/plugin`, open
Marketplaces, pick kadaliao and choose **Enable auto-update**.

## Local development

```bash
git clone git@github.com:kadaliao/claude-mods.git ~/workspace/claude-mods
claude --plugin-dir ~/workspace/claude-mods/statusline
```

`--plugin-dir` loads the working copy for that session and reloads it as you save. Uninstall the
GitHub copy first (`claude plugin uninstall <mod>@kadaliao`) if both should not run at once.

License: MIT
