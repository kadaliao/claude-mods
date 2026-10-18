# claude-mods

English | [简体中文](README.zh-CN.md)

Mods for [Claude Code](https://code.claude.com): plugins of function hooks that change Claude Code's
own interface and behaviour. Each mod lives in its own directory with its own
`.claude-plugin/plugin.json`, and the repository is a plugin marketplace named `kadaliao`, so each
mod installs separately.

| Mod | What it does | Install |
| --- | --- | --- |
| [tps-meter](tps-meter/) | Time to first token and output tokens/s of every model request, for your status line | `/plugin install tps-meter --marketplace kadaliao/claude-mods` |

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
claude --plugin-dir ~/workspace/claude-mods/tps-meter
```

`--plugin-dir` loads the working copy for that session and reloads it as you save. Uninstall the
GitHub copy first (`claude plugin uninstall <mod>@kadaliao`) if both should not run at once.

License: MIT
