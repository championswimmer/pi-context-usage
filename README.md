# pi-context-usage

A [pi](https://github.com/badlogic/pi-mono) extension that visualizes context window usage with the `/context` command.

## Usage

```
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

## Install

### As a pi package

```bash
pi install git:github.com/youruser/pi-context-usage
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
