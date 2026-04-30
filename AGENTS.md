# AGENTS.md — pi-context-usage

## Overview

This is a **pi extension** that adds a `/context` slash command to [pi](https://github.com/badlogic/pi-mono), a coding agent. The command displays a dot-grid visualization of context window token usage (system/tools, messages, free space, output buffer).

## Repository Structure

```
.
├── AGENTS.md              # This file
├── README.md              # User-facing docs, install instructions, usage examples
├── package.json           # Package manifest (pi extension entry point, dependencies)
├── src/
│   └── index.ts           # Entire extension source — single file
└── tests/
    └── mock-context.ts    # Standalone mock/render test (no pi session needed)
```

## Key Files

### `src/index.ts`
The **only source file**. Contains the full extension implementation:
- Exports a default function receiving `ExtensionAPI` from pi
- Registers a `/context` command via `pi.registerCommand()`
- Reads context usage from `ctx.getContextUsage()` and model info from `ctx.model`
- Estimates **system/tools** tokens using cache heuristics from session history:
  - Iterates `ctx.sessionManager.getBranch()` backwards to find the last successful assistant message with `usage` data
  - Uses `cacheRead + cacheWrite` as a proxy for system prompt + tool definition tokens (these portions are typically cached between turns)
  - Falls back to a 15% estimate of `usedTokens` when no cache data is available
- Reserves `model.maxTokens` as the **buffer** (output space) — pi triggers compaction when used tokens encroach this reserve (`reserveTokens`)
- Calculates **free tokens** as `contextWindow − usedTokens − bufferTokens` (clamped to ≥ 0)
- Builds an **8×11 dot-grid** visualization using Unicode symbols `◍ ● · ○`, inspired by the GitHub Copilot coding agent style
- Colors cells via `colorCell()` mapping each symbol to a `ctx.ui.theme` color role
- Formats token counts via `fmtTokens()` helper (adds `k`/`m` suffixes for large numbers)
- Uses `ctx.ui.notify()` to display the assembled output

> **Note:** The file header comment still shows old symbols (`◉ ◎`) — a stale comment; the actual runtime symbols are `◍` (system) and `○` (buffer).

### `tests/mock-context.ts`
A standalone Bun script that exercises the extension logic against mock token data, without a live pi session. Uses `mockCtx` / `mockPi` shims and logs captured `notify()` output to the terminal. Useful for quickly verifying grid layout and color rendering changes.

```bash
bun run test:mock
```

### `package.json`
- `pi.extensions` → `["./src/index.ts"]` (extension entry point)
- `keywords: ["pi-package"]` — marks this as installable via `pi install`
- `scripts.test:mock` — runs `tests/mock-context.ts` via Bun
- Runtime deps: `@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui`, `@sinclair/typebox`
- Dev deps: `typescript`

## Development

```bash
# Load extension directly into a live pi session
pi -e ./src/index.ts

# Type /context after sending at least one message

# Run standalone mock render test (no pi session needed)
bun run test:mock
```

## Architecture Notes

- **No build step required** — pi loads `.ts` files directly via Bun
- **Single-file extension** — all logic is in `src/index.ts`; no utilities, no config files
- The extension is **stateless**: reads all data from live session state on each invocation

### Token Breakdown (4 Categories)

| Category     | Symbol | Theme color role | Token source |
|--------------|--------|------------------|--------------|
| System/Tools | `◍`    | `accent`         | `cacheRead + cacheWrite` from last assistant `usage`; falls back to 15% of `usedTokens` |
| Messages     | `●`    | `success`        | `usedTokens − systemToolsTokens` |
| Free Space   | `·`    | `dim`            | `contextWindow − usedTokens − bufferTokens` (clamped to ≥ 0) |
| Buffer       | `○`    | `warning`        | `model.maxTokens` — reserved output space; pi triggers compaction when context usage reaches this boundary |

### Grid Layout

- Fixed **8 rows × 11 columns** = 88 cells total
- Each cell ≈ `contextWindow / 88` tokens
- Flat cell array fills left-to-right, top-to-bottom: system first → messages → free space → buffer appended at the tail
- Non-zero categories always get at least 1 cell; overflow is resolved by reducing buffer cells first (clamped to 0), then excess cells are `pop()`-ed from the tail

### Sample Output

```
Context Usage

◍ ◍ ◍ ◍ ◍ ◍ ◍ ◍ ◍ ● ●
● ● ● ● ● · · · · · ·
· · · · · · · · · · ·
· · · · · · · · · · ·
· · · · · · · · · · ·
· · · · · · · · · · ·
· · · · · · · · · · ·
· · · · · · ○ ○ ○ ○ ○

claude-sonnet-4-5   23.4k / 200.0k tokens (12%)

◍ System/Tools:    19.4k (10%)
● Messages:          4.0k (2%)
· Free Space:      160.2k (80%)
○ Buffer:           16.4k (8%)
```
