---
name: 001-context-details
description: Extend /context with a `details` subcommand that lets the user expand and scroll through a token breakdown of the system prompt + each tool definition, and a one-line-per-turn breakdown of the conversation so far.
steps:
  - phase: discovery
    steps:
      - "- [ ] step 1: confirm `estimateTokens(message)` is exported from `@mariozechner/pi-coding-agent` (it is — re-exported from `core/compaction/compaction.js`, chars/4 heuristic; images counted as 1200 tokens)"
      - "- [ ] step 2: confirm `ctx.getSystemPrompt()` is available in `ExtensionCommandContext` and returns the fully-built system prompt string (yes — documented in extensions.md `ExtensionContext` section)"
      - "- [ ] step 3: confirm `pi.getActiveTools()` / `pi.getAllTools()` return `{ name, description, parameters, sourceInfo }` (yes — extensions.md, Tools section); decide to use `getActiveTools()` since only those are sent to the model"
      - "- [ ] step 4: verify there is no public API that returns Pi's exact serialized tool-definition payload — so per-tool tokens must be approximated by `name.length + description.length + JSON.stringify(parameters).length` divided by 4"
      - "- [ ] step 5: confirm `ctx.sessionManager.getBranch()` returns the full active path of `SessionEntry` objects (header + messages + custom + compaction + …); only `entry.type === 'message'` carries an `AgentMessage` we can pass to `estimateTokens`"
      - "- [ ] step 6: confirm the assistant `usage.cacheRead + cacheWrite` heuristic still gives a good overall System/Tools number to keep the top grid identical, and that the *details* view's sum-of-parts (system prompt + per-tool) will likely be smaller than the cached number (provider overhead + boilerplate is not visible to the extension) — note this discrepancy in the UI"
      - "- [ ] step 7: review TUI patterns in `docs/tui.md` (`SelectList`, `BorderedLoader`, overlays, scrollable lists) and decide between (a) `ctx.ui.notify()` plain-text dump or (b) interactive `ctx.ui.custom()` overlay; pick (b) for `hasUI=true`, fallback to (a) for `hasUI=false`"
      - "- [ ] step 8: read `examples/extensions/preset.ts` and `examples/extensions/tools.ts` for working `SelectList` patterns to crib"
  - phase: refactor-baseline
    steps:
      - "- [ ] step 1: split `src/index.ts` into `src/index.ts` (entry/registration), `src/release.ts` (existing release command), `src/context/index.ts` (command + arg routing), `src/context/tokens.ts` (token math helpers), `src/context/grid.ts` (current dot-grid renderer), `src/context/breakdown.ts` (new system/tools + per-turn breakdown calculations)"
      - "- [ ] step 2: extract pure helpers `computeUsageBuckets(usage, branch, model)`, `fmtTokens(n)`, `colorCell(sym, theme)`, and `renderGrid(buckets, theme)` so both plain and details views share them"
      - "- [ ] step 3: keep `tests/mock-context.ts` green by re-exporting the shared helpers and updating its imports"
  - phase: argument-routing
    steps:
      - "- [ ] step 1: add `getArgumentCompletions` to the `/context` command exposing `details`"
      - "- [ ] step 2: parse `args` in the handler: empty → existing grid view; `details` → details flow; anything else → notify usage hint"
      - "- [ ] step 3: update README usage section to document `/context` and `/context details`"
  - phase: system-tools-breakdown
    steps:
      - "- [ ] step 1: in `breakdown.ts`, implement `computeSystemPromptTokens(systemPromptText)` returning `Math.ceil(text.length / 4)`"
      - "- [ ] step 2: implement `computeToolBreakdown(activeTools)` returning `{ name, descTokens, paramsTokens, totalTokens, totalChars }[]` sorted desc by `totalTokens`; per-tool chars = `name.length + (description?.length ?? 0) + JSON.stringify(parameters ?? {}).length`"
      - "- [ ] step 3: implement `computeSystemToolsSection(ctx, pi)` that returns `{ systemPrompt: { tokens, chars }, tools: ToolBreakdown[], totalTokens, cachedTokens }` where `cachedTokens` is the existing `cacheRead + cacheWrite` figure for the discrepancy banner"
      - "- [ ] step 4: render section as a header line (`System prompt: 6.2k tokens (24,800 chars)`) + a list `<tool name>  <tokens>  (<chars> chars)` aligned in columns, with totals row at the bottom"
      - "- [ ] step 5: include a small note when `sum(parts) ≠ cachedTokens` explaining that the cached number includes provider-side overhead (system message envelope, tool-use protocol scaffolding, etc.) not visible to the extension"
  - phase: conversation-breakdown
    steps:
      - "- [ ] step 1: in `breakdown.ts`, implement `computeTurnBreakdown(branch)` that walks `getBranch()` and produces an array of turns; a turn starts at each `user` message and accumulates the following `assistant`, `toolResult`, `bashExecution`, `custom`, and `compactionSummary` messages until the next user message"
      - "- [ ] step 2: for each turn entry, compute `estimateTokens(entry.message)` summed across messages in the turn; also keep per-message detail (role, one-line preview, tokens, chars) for an optional second-level expand"
      - "- [ ] step 3: build a one-line preview per turn: `#<n>  <hh:mm>  <role-icon>  <80-char snippet>  <tokens>` — snippet built from first text block stripped of newlines"
      - "- [ ] step 4: handle non-message entries (`compaction`, `branch_summary`, `model_change`, `thinking_level_change`, `label`, `custom`) gracefully — skip those that aren't billable, but show `compaction` summary token total inline as its own pseudo-turn"
      - "- [ ] step 5: include cumulative running total column on the right so user sees how tokens accrue across the conversation"
  - phase: tui-rendering
    steps:
      - "- [ ] step 1: when `ctx.hasUI === false`, render plain text via `ctx.ui.notify()`: header grid (existing) + system/tools section + truncated turn list (max 30 rows, with `… N more turns`)"
      - "- [ ] step 2: when `ctx.hasUI === true`, build a `Container` with: top `DynamicBorder`, title, the current dot-grid summary (always visible at top for continuity), blank line, then a custom collapsible-section list component"
      - "- [ ] step 3: implement a `CollapsibleSection` component (or reuse a `Container` + custom keyboard handling) with three top-level sections — `▸ System Prompt`, `▸ Tools (N)`, `▸ Conversation (N turns)` — each expandable with Enter/Right and collapsible with Left; only the focused section's children are scrollable"
      - "- [ ] step 4: keyboard model — `↑/↓` move focus across visible rows (section headers + expanded children); `Enter` or `→` expand a collapsed section / drill into a row; `←` collapse the current section / pop drill-down; `Tab` jump between top-level sections; `Esc` close the overlay; `q` also closes; help footer reflects this"
      - "- [ ] step 5: use `ctx.ui.custom()` with `{ overlay: true, overlayOptions: { width: '90%', maxHeight: '90%', anchor: 'center' } }` and `getSelectListTheme()` palette for the focused row"
      - "- [ ] step 6: color-code turn rows by role using theme.fg() — user=`accent`, assistant=`success`, tool-heavy turn (>50% tokens from toolResult/bashExecution)=`warning`, compaction pseudo-turn=`muted`; apply `theme.bold()` to the role icon and the token-count column for emphasis; tool rows use `accent`; system prompt header uses `theme.bold(theme.fg('accent', …))`"
      - "- [ ] step 7: drill-down for a turn row — expand inline (indent + child rows) showing each message with role + tokens + ~120-char preview (never full body); collapsing returns to the turn-level view; same inline-expand pattern for a tool row showing first ~10 pretty-printed JSON schema lines + token/char summary"
      - "- [ ] step 8: implement scrolling within the overlay — track a `scrollOffset` against visible height (overlay height − grid summary − borders − footer); clamp focus to keep selected row in view; respect `PageUp/PageDown` and `Home/End`"
      - "- [ ] step 9: implement `invalidate()` correctly per `docs/tui.md` Rebuild-on-Invalidate pattern so theme changes do not leave stale ANSI codes; rebuild row strings inside `invalidate()`, not in the constructor"
  - phase: tests-and-mocks
    steps:
      - "- [ ] step 1: extend `tests/mock-context.ts` mocks: add `getSystemPrompt()` returning a sample multi-kilobyte string, `getAllTools()` / `getActiveTools()` returning 4–5 mock tools with realistic JSON-schema params, and a `getBranch()` returning a fabricated 6-turn conversation (mix of text, tool calls, tool results)"
      - "- [ ] step 2: add a `test:mock-details` script that invokes `/context details` and prints the captured rendering so layout changes can be eyeballed in CI logs"
      - "- [ ] step 3: add unit-style assertions: tools sorted desc by tokens, turns count matches user-message count, sum(turn tokens) ≈ estimateTokens-of-branch sanity check"
      - "- [ ] step 4: spot-check live behavior with `pi -e ./src/index.ts` after sending ≥3 user messages, run `/context` (unchanged) then `/context details` (new view)"
  - phase: docs-and-release
    steps:
      - "- [ ] step 1: update `README.md` with a `/context details` section + sample output for the system/tools panel and the per-turn list"
      - "- [ ] step 2: update `AGENTS.md` to reflect the new file layout under `src/context/` and the new architecture notes (token-estimate provenance, per-turn grouping rules)"
      - "- [ ] step 3: bump version (`patch` if no breaking behavior change), run `npm run test:mock` and `test:mock-details`, then `/release patch` per the release skill"
---

# 001-context-details

A research-backed plan to extend the `/context` extension so that running `/context details` opens an expanded, scrollable breakdown of (1) per-tool & system-prompt token usage and (2) one-line-per-turn conversation token usage. The bare `/context` command keeps its current dot-grid behavior unchanged.

## Background — what pi gives us

| Need | API | Notes |
|---|---|---|
| System prompt text | `ctx.getSystemPrompt()` | Returns the fully-built system prompt string at call time. Documented in `pi/docs/extensions.md` (ExtensionContext). |
| Active tools (name, description, parameters JSON schema) | `pi.getActiveTools()` | Returns `{ name, description, parameters, sourceInfo }[]` for tools currently sent to the LLM. |
| Per-message token estimate | `import { estimateTokens } from "@mariozechner/pi-coding-agent"` | Pi's own `chars/4` heuristic — same one used internally for compaction. Handles user/assistant/toolResult/bashExecution/custom; counts images as 1200 tokens. |
| Conversation history | `ctx.sessionManager.getBranch()` | Walks current leaf to root; entries with `type === "message"` carry the `AgentMessage` we feed to `estimateTokens`. |
| Last assistant `usage` (cache numbers) | Walk branch backwards → first non-aborted assistant `entry.message.usage` | Already used today for the System/Tools heuristic. Kept as the *authoritative* number on the grid. |
| TUI building blocks | `ctx.ui.custom()`, `SelectList`, `DynamicBorder`, `getSelectListTheme()`, overlay options | See `pi/docs/tui.md` patterns 1, 5, 6. |

### Important caveat
Pi does not expose the exact provider-serialized payload, so per-tool tokens we compute will under-count what the provider actually charges (system envelope, tool-use protocol scaffolding, etc.). The details view will surface a small note when our `sum(systemPrompt + tools)` differs from the assistant's reported `cacheRead + cacheWrite`.

## Phase 1 — Discovery
- [ ] step 1: confirm `estimateTokens(message)` is exported from `@mariozechner/pi-coding-agent` (it is — re-exported from `core/compaction/compaction.js`, chars/4 heuristic; images counted as 1200 tokens)
- [ ] step 2: confirm `ctx.getSystemPrompt()` is available in `ExtensionCommandContext` and returns the fully-built system prompt string
- [ ] step 3: confirm `pi.getActiveTools()` / `pi.getAllTools()` return `{ name, description, parameters, sourceInfo }`; use `getActiveTools()` since only those are sent
- [ ] step 4: verify no public API returns Pi's exact serialized tool payload — per-tool tokens must be approximated via `name + description + JSON.stringify(parameters)` / 4
- [ ] step 5: confirm `ctx.sessionManager.getBranch()` shape and that only `entry.type === 'message'` entries carry billable `AgentMessage`s
- [ ] step 6: note the `cacheRead + cacheWrite` vs `sum(parts)` discrepancy and surface it in the UI
- [ ] step 7: pick (a) plain `notify()` text for `hasUI=false` and (b) interactive `ctx.ui.custom()` overlay for `hasUI=true`
- [ ] step 8: study `examples/extensions/preset.ts` and `examples/extensions/tools.ts` for working SelectList patterns

## Phase 2 — Refactor baseline
- [ ] step 1: split `src/index.ts` into `src/index.ts`, `src/release.ts`, `src/context/index.ts`, `src/context/tokens.ts`, `src/context/grid.ts`, `src/context/breakdown.ts`
- [ ] step 2: extract `computeUsageBuckets`, `fmtTokens`, `colorCell`, `renderGrid` helpers shared by both views
- [ ] step 3: keep `tests/mock-context.ts` green after the split

## Phase 3 — Argument routing
- [ ] step 1: add `getArgumentCompletions` exposing `details`
- [ ] step 2: parse args: empty → grid; `details` → details flow; else → usage hint
- [ ] step 3: README + `--help`-style docstring updates

## Phase 4 — System / tools breakdown
- [ ] step 1: implement `computeSystemPromptTokens(text)` (chars/4)
- [ ] step 2: implement `computeToolBreakdown(activeTools)` returning `{ name, descTokens, paramsTokens, totalTokens, totalChars }[]` sorted desc by tokens
- [ ] step 3: implement `computeSystemToolsSection(ctx, pi)` aggregating both + cached number for the discrepancy banner
- [ ] step 4: render section: header + columns of `name  tokens  chars` + totals row
- [ ] step 5: surface the `sum(parts) ≠ cached` discrepancy as a one-line note

## Phase 5 — Conversation breakdown
- [ ] step 1: implement `computeTurnBreakdown(branch)` — turns start at each `user` message; accumulate following assistant/toolResult/bashExecution/custom/compactionSummary until next user
- [ ] step 2: per-turn token sum via `estimateTokens`; keep per-message details for second-level expand
- [ ] step 3: per-turn one-liner `#n  hh:mm  <role>  <80-char snippet>  <tokens>`
- [ ] step 4: handle non-billable entries (model_change, label, etc.) — skip; surface `compaction` summary as its own pseudo-turn
- [ ] step 5: cumulative running-total column on the right

## Phase 6 — TUI rendering
- [ ] step 1: `hasUI=false` → `ctx.ui.notify()` plain text dump: grid + system/tools section + first ~30 turns with `… N more turns` footer
- [ ] step 2: `hasUI=true` → `ctx.ui.custom()` overlay with `Container` of grid summary (always visible) + custom collapsible-section list
- [ ] step 3: implement a `CollapsibleSection` component with three top-level sections — `▸ System Prompt`, `▸ Tools (N)`, `▸ Conversation (N turns)` — expandable/collapsible; only the focused section's children scroll
- [ ] step 4: keyboard model — `↑/↓` move focus, `Enter`/`→` expand or drill in, `←` collapse / pop drill-down, `Tab` jump between top-level sections, `Esc` or `q` close; footer reflects this
- [ ] step 5: use `ctx.ui.custom()` with `{ overlay: true, overlayOptions: { width: '90%', maxHeight: '90%', anchor: 'center' } }` and `getSelectListTheme()` palette for focused row
- [ ] step 6: color-code turns — user=`accent`, assistant=`success`, tool-heavy=`warning`, compaction=`muted`; bold role icon and token count; tools use `accent`; system prompt header bold accent
- [ ] step 7: inline drill-down for turn rows (indented child rows: role + tokens + ~120-char preview, never full body) and tool rows (first ~10 lines of pretty-printed schema + token/char summary)
- [ ] step 8: scrolling within overlay — track `scrollOffset` vs visible height, clamp focus into view, support `PageUp/PageDown` and `Home/End`
- [ ] step 9: implement `invalidate()` per docs Rebuild-on-Invalidate pattern; rebuild styled row strings inside `invalidate()`, not the constructor

## Phase 7 — Tests & mocks
- [ ] step 1: extend `tests/mock-context.ts` with `getSystemPrompt()`, `getAllTools()` / `getActiveTools()`, and a 6-turn fabricated branch
- [ ] step 2: add `test:mock-details` npm script that prints captured details rendering
- [ ] step 3: assert tools sorted desc, turn count matches user-message count, sum-of-turn-tokens ≈ branch-sum sanity check
- [ ] step 4: live spot-check with `pi -e ./src/index.ts`

## Phase 8 — Docs & release
- [ ] step 1: README — new `/context details` section + sample output
- [ ] step 2: AGENTS.md — updated repo layout & architecture notes
- [ ] step 3: `npm run test:mock && npm run test:mock-details`, then `/release patch`

## Resolved design decisions
1. **Grid stays.** The dot-grid summary is always shown at the top of the details overlay for continuity with the bare `/context` view.
2. **Color + bold turn coding.** Turns are color-coded by role — user=`accent`, assistant=`success`, tool-heavy turn=`warning`, compaction=`muted` — and key columns (role icon, token count) use `theme.bold()` for emphasis. Tools section uses `accent`; system prompt header is bold accent.
3. **No sub-args.** `/context details` is the only entry point. Section navigation, expand/collapse, and drill-down all happen inside the TUI via the keyboard model defined in Phase 6 step 4.
