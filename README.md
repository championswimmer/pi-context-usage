# pi-context-usage

A [pi](https://github.com/badlogic/pi-mono) extension package that visualizes context window usage with `/context`, and includes a release workflow via `/release` plus a packaged `release` skill.

## Usage

### Context visualization

```text
/context
```

Displays a dot-grid visualization of your context window:

```
Context Usage

◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉
● ● ● ● · · · · · · ·
· · · · · · · · · · ·
· · · · · · · · · · ·
· · · · · · · · · · ·
· · · · · · · · · · ·
        ◎ ◎ ◎ ◎ ◎ ◎ ◎
◎ ◎ ◎ ◎ ◎ ◎ ◎ ◎ ◎ ◎ ◎

claude-sonnet-4-20250514   73k / 200k tokens (37%)

◉ System/Tools:   30.0k (15%)
● Messages:       43.0k (22%)
· Free Space:     78.6k (39%)
◎ Buffer:         48.4k (24%)
```

### Release automation

```text
/release patch
/release minor
/release major
```

The `/release` command will:

- verify the git working tree is clean
- run `npm run test:mock`
- bump `package.json` and `package-lock.json`
- create a `release: vX.Y.Z` commit
- publish to npm
- create a `vX.Y.Z` git tag
- push the branch and tag to GitHub

Prerequisites:

- you are on the branch you want to release from
- you can push to the repository remote
- `npm whoami` succeeds for an account that can publish `pi-context-usage`

### Release skill

This package also ships a `release` skill that teaches pi when and how to use the repo's release flow. If the skill is loaded manually, it will direct the agent to prefer:

```text
/release major|minor|patch
```

## Install

### As a pi package

```bash
pi install git:github.com/championswimmer/pi-context-usage
```

### Manual (project-local)

Copy or symlink this directory into `.pi/extensions/pi-context-usage/`.

### Quick test

```bash
pi -e ./src/index.ts
```

## How it works

- **System/Tools** (◉): Estimated from cache token counts in the last assistant response (cache typically holds the system prompt and tool definitions). Falls back to ~15% estimate if no cache data available.
- **Messages** (●): Conversation messages (user + assistant + tool results).
- **Free Space** (·): Remaining tokens available for conversation.
- **Buffer** (◎): Reserved for model output (`maxTokens`).
