# AGENTS.md — pi-context-usage

## Overview

This is a **pi extension** that adds a `/context` slash command to [pi](https://github.com/badlogic/pi-mono), a coding agent. The command displays a dot-grid visualization of context window token usage (system/tools, messages, free space, output buffer).

## Repository Structure

```
.
├── AGENTS.md              # This file
├── README.md              # User-facing docs, install instructions, usage examples
├── package.json           # Package manifest (pi extension entry point, dependencies)
└── src/
    └── index.ts           # Entire extension source — single file
```

## Key Files

### `src/index.ts`
The **only source file**. Contains the full extension implementation:
- Exports a default function receiving `ExtensionAPI` from pi
- Registers a `/context` command via `pi.registerCommand()`
- Reads context usage from `ctx.getContextUsage()` and model info from `ctx.model`
- Estimates system/tools vs message tokens using cache token heuristics from session history
- Builds an 8×11 dot-grid visualization using Unicode symbols (◉ ● · ◎)
- Uses `ctx.ui.theme` for colored output and `ctx.ui.notify()` to display results

### `package.json`
- `pi.extensions` array points to `./src/index.ts` (the extension entry point)
- `keywords: ["pi-package"]` marks this as installable via `pi install`
- Dependencies: `@mariozechner/pi-coding-agent` (extension API types), `@mariozechner/pi-tui` (TUI framework), `@sinclair/typebox`

## Development

```bash
# Quick test — load extension directly
pi -e ./src/index.ts

# Then type /context after sending at least one message
```

## Architecture Notes

- **No build step required** — pi loads `.ts` files directly via Bun
- **Single-file extension** — all logic is in `src/index.ts`; no utilities, no config files
- The extension is stateless; it reads session data on each `/context` invocation
- Token breakdown uses cache read/write counts as a proxy for system prompt + tool definition size; falls back to a 15% estimate when cache data is unavailable
