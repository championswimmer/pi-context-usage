# AGENTS.md — pi-context-usage

## Overview

This is a **pi extension** that adds two context-inspection commands to [pi](https://github.com/badlogic/pi-mono):

- `/context` — the compact dot-grid visualization of context-window usage
- `/context details` — a deeper token breakdown for the visible system prompt, active tools, and conversation turns

The repository also includes the `/release` command and a matching `release` skill.

## Repository Structure

```text
.
├── AGENTS.md
├── README.md
├── package.json
├── src/
│   ├── index.ts                # Entry point; registers commands and re-exports helpers
│   ├── release.ts              # /release implementation
│   └── context/
│       ├── index.ts            # /context command routing + details overlay/plain rendering
│       ├── tokens.ts           # Usage bucket math and shared formatting helpers
│       ├── grid.ts             # Dot-grid rendering shared by summary/details views
│       └── breakdown.ts        # System/tools + conversation breakdown calculations
└── tests/
    └── mock-context.ts         # Standalone Bun mock for /context and /context details
```

## Key Files

### `src/index.ts`
Small entry point that:
- registers `/context` from `src/context/index.ts`
- registers `/release` from `src/release.ts`
- re-exports shared helpers used by the mock test

### `src/context/tokens.ts`
Contains the shared token-bucket logic for the summary grid:
- finds the last successful assistant `usage`
- uses `cacheRead + cacheWrite` as the main **System/Tools** estimate
- falls back to `15%` of used tokens when cache information is unavailable
- computes **Messages**, **Free Space**, and **Buffer** buckets
- exposes `fmtTokens()`, `formatInt()`, cell symbols, and grid-cell allocation helpers

### `src/context/grid.ts`
Renders the existing **8 × 11** dot-grid summary and its legend. This keeps bare `/context` behavior stable while also letting the details view reuse the same summary block at the top.

### `src/context/breakdown.ts`
Contains the deeper `/context details` calculations:
- **System prompt** tokens from `ctx.getSystemPrompt()` using `chars / 4`
- **Tool breakdown** from `pi.getAllTools()` filtered by `pi.getActiveTools()`
- **Conversation turns** grouped by user message, with compaction entries rendered as their own pseudo-turns
- turn totals derived from pi's exported `estimateTokens(message)` heuristic

### `src/context/index.ts`
Implements `/context` command routing:
- empty args → summary grid via `ctx.ui.notify()`
- `details` → plain-text details when `ctx.hasUI === false`
- `details` → interactive overlay when `ctx.hasUI === true`

The overlay keeps the summary grid visible and provides expandable sections for:
- System Prompt
- Tools
- Conversation

### `src/release.ts`
Contains the extracted `/release` workflow:
- validates git state
- verifies npm auth and unpublished version
- runs `npm run test:mock`
- bumps version, commits, publishes, tags, and pushes

### `tests/mock-context.ts`
Standalone Bun test script that:
- mocks a system prompt, active tools, and a multi-turn branch
- exercises both `/context` and `/context details`
- prints captured output for visual inspection
- asserts tool sorting and turn-count/token-count sanity checks

## Development

```bash
# Load extension directly into pi
pi -e ./src/index.ts

# After sending a few messages
/context
/context details

# Mock tests
bun run test:mock
bun run test:mock-details
```

## Architecture Notes

- **No build step required** — pi loads `.ts` files directly via Bun
- **Stateless command logic** — every invocation reads live session state from `ctx`
- **Shared summary renderer** — both `/context` and `/context details` use the same grid/bucket helpers
- **Approximate details math** — visible system prompt + tool totals are intentionally approximate because pi does not expose the exact provider-side serialized payload
- **Authoritative top-level number** — the summary grid still trusts assistant cache usage (`cacheRead + cacheWrite`) for System/Tools

## Token Breakdown Categories

| Category     | Symbol | Theme color role | Token source |
|--------------|--------|------------------|--------------|
| System/Tools | `◍`    | `accent`         | `cacheRead + cacheWrite` from the last successful assistant usage; fallback `15%` heuristic |
| Messages     | `●`    | `success`        | `usedTokens - systemToolsTokens` |
| Free Space   | `·`    | `dim`            | `contextWindow - usedTokens - bufferTokens` |
| Buffer       | `○`    | `warning`        | `model.maxTokens` reserved for output |

## Details View Rules

### System / tools section

- System prompt estimate: `Math.ceil(systemPrompt.length / 4)`
- Tool estimate: `name + description + JSON.stringify(parameters)` using the same `chars / 4` heuristic
- Tools are sorted descending by estimated token cost
- If visible `system prompt + tools` differs from cached assistant tokens, the UI shows a note explaining that provider-side envelopes/tool protocol overhead are not visible to extensions

### Conversation section

- A **turn** starts at each `user` message
- Following `assistant`, `toolResult`, `bashExecution`, and `custom` entries are grouped into that turn until the next user message
- `compaction` entries are shown as their own pseudo-turn with a `Σ` marker
- Each row includes per-turn tokens and a cumulative running total
- Expanded turn rows show per-message previews only, never full message bodies
