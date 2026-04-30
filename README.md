# pi-context-usage

A [pi](https://github.com/badlogic/pi-mono) extension package that adds:

- `/context` — a dot-grid visualization of current context usage
- `/context details` — a deeper breakdown of system prompt, active tools, and conversation turns
- `/release <major|minor|patch>` — the repository release workflow

## Usage

### Context summary

```text
/context
```

Shows the existing dot-grid summary:

```text
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

◍ Cached Prompt*:  19.4k (10%)
● Other Context:     4.0k (2%)
· Free Space:      160.2k (80%)
○ Buffer:           16.4k (8%)
* From the last assistant cache (cacheRead + cacheWrite); details below use visible-entry estimates and will differ.
```

### Context details

```text
/context details
```

When UI is available, this opens a keyboard-driven overlay that keeps the grid summary at the top and adds expandable sections for:

- **System Prompt** — visible system prompt token estimate from `ctx.getSystemPrompt()`
- **Tools** — active tool breakdown from `pi.getAllTools()` filtered by `pi.getActiveTools()`
- **Conversation** — one line per user turn, plus inline compaction summaries and per-message drill-down

Keyboard shortcuts in the overlay:

- `↑/↓` move focus
- `Enter` or `→` expand a section/row
- `←` collapse a section/row
- `Tab` jump between top-level sections
- `PageUp/PageDown`, `Home/End` scroll faster
- `Esc` or `q` close

When UI is not available, `/context details` falls back to a plain-text dump.

Example plain-text output:

```text
System / Tools Details

Item                Tokens  Chars
System prompt         6.2k  24,800
read                    70     279
bash                    61     244
edit                   142     567
Total visible parts    6.5k  25,890

Note: visible parts sum to 6.5k tokens, while the top summary uses 19.4k cached prompt tokens from the last assistant cache. That cache number includes provider-side scaffolding and cached context that extensions cannot inspect.

Conversation (6 turns)
Per-turn and cumulative values are visible-entry estimates from estimateTokens(message); they will not match the summary's provider/cache totals.

 #1  10:41  U  Inspect the current implementation of /context.      1.1k    1.1k cum est
 #2  10:44  U  Draft a plan for /context details.                    0.8k    1.9k cum est
  Σ  10:45  Σ  Earlier discussion established the design…            0.4k    2.3k cum est
 #3  10:49  U  Implement the refactor baseline first.                1.3k    3.6k cum est
```

## Install

### As a pi package

```bash
pi install git:github.com/championswimmer/pi-context-usage
```

### Manual (project-local)

Copy or symlink this directory into `.pi/extensions/pi-context-usage/`.

## Development

```bash
# Load extension directly into a live pi session
pi -e ./src/index.ts

# After sending at least one message
/context
/context details

# Standalone mock tests
bun run test:mock
bun run test:mock-details
```

## How it works

### Summary buckets

- **Cached Prompt** (`◍`): uses the last successful assistant `usage.cacheRead + usage.cacheWrite` when available, otherwise falls back to a 15% estimate of used tokens
- **Other Context** (`●`): `usedTokens - systemToolsTokens`
- **Free Space** (`·`): `contextWindow - usedTokens - bufferTokens`
- **Buffer** (`○`): reserved model output space from `model.maxTokens`

### Details view estimates

- **System prompt tokens**: `Math.ceil(systemPrompt.length / 4)`
- **Per-tool tokens**: `Math.ceil((name + description).length / 4) + Math.ceil(JSON.stringify(parameters).length / 4)`
- **Turn tokens**: summed via pi's exported `estimateTokens(message)` heuristic

Because pi does not expose the exact provider-serialized request payload, the visible `system prompt + tools` total is intentionally labeled as an approximation. The cached assistant number remains the authoritative top-level cached-prompt value used by the grid, and it is not directly comparable to the visible estimates in the details view.

## Release automation

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

## Release skill

This package also ships a `release` skill that teaches pi when and how to use the repo's release flow. If the skill is loaded manually, it will direct the agent to prefer:

```text
/release major|minor|patch
```
