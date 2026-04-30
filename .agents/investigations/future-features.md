# Feature Ideas for pi-context-usage

**Date:** 2026-04-30  
**Author:** AI investigation  
**Scope:** Potential enhancements to the `/context` pi extension

---

## Background

The current extension provides a single on-demand `/context` command that renders an 8×11 dot-grid of context window usage split into four categories (System/Tools, Messages, Free Space, Buffer). It is purely read-only and stateless — it reads session state at invocation time and renders.

The pi `ExtensionAPI` exposes considerably more than what the current extension uses. This report inventories feature ideas organised by effort and value, noting which specific APIs each would use.

---

## API Capabilities Not Yet Used

Before listing ideas, here's what the `ExtensionAPI` offers that the extension currently ignores:

| API | Description |
|-----|-------------|
| `pi.on("turn_end", handler)` | Fires after every agent turn with the full assistant message + all tool results |
| `pi.on("tool_result", handler)` | Fires after each individual tool execution with `toolName`, `content`, `isError` |
| `pi.on("before_agent_start", handler)` | Fires before the agent loop starts; payload includes the full `systemPrompt` string |
| `pi.on("session_before_compact", handler)` | Fires just before pi triggers context compaction |
| `pi.on("session_compact", handler)` | Fires after compaction completes |
| `pi.on("model_select", handler)` | Fires when the active model changes |
| `ctx.ui.setStatus(key, text)` | Sets a persistent text badge in the footer status area |
| `ctx.ui.setWidget(key, content, opts)` | Renders a persistent widget above or below the editor |
| `ctx.compact(options)` | Programmatically triggers context compaction |
| `model.cost.{input,output,cacheRead,cacheWrite}` | Per-token USD pricing for cost estimation |
| `pi.registerShortcut(key, handler)` | Registers a keyboard shortcut |

---

## Feature Ideas

---

### 1. 📊 Persistent Context Footer Badge *(Low effort, High value)*

**What:** After every agent turn, automatically update a compact token usage indicator in the pi footer — visible at all times without typing `/context`.

**Example:** `[◍◍●···○] 23k/200k (12%) ↑3.1k`

**How:**
- Subscribe to `pi.on("turn_end")`
- On each turn, call `ctx.getContextUsage()` and compute token delta vs. previous turn
- Call `ctx.ui.setStatus("context-usage", formattedBadge)`

**Why it matters:** Developers currently have no ambient awareness of context fill level. A footer badge (like VS Code's git branch indicator) gives persistent context health at zero cognitive cost.

**Research note:** GitHub Copilot agent mode shows a "context used" indicator in the chat UI. Claude Code shows a compact token count inline. pi currently shows nothing — this closes that gap.

---

### 2. 📈 Per-turn Token Growth History & Sparkline *(Medium effort, High value)*

**What:** Track how many tokens were consumed at each agent turn. When `/context` is called, show a sparkline history like:

```
Token growth history (last 10 turns):
▁▁▂▂▃▃▄▅▆█  (turn 1 → 10)
  avg +2.3k/turn · projected ~38 turns until compaction
```

**How:**
- Subscribe to `pi.on("turn_end")`, snapshot `ctx.getContextUsage().tokens` in a module-level array
- In the `/context` command renderer, append the sparkline using Unicode block chars `▁▂▃▄▅▆▇█`
- Compute average delta and project turns remaining as `freeTokens / avgDelta`

**Sparkline encoding:**
```ts
const BLOCKS = "▁▂▃▄▅▆▇█";
// Map each turn's delta to a block height based on max delta in window
```

**Why it matters:** The static dot-grid shows a snapshot but not trajectory. A sparkline makes it immediately obvious if context is growing linearly (normal) or exponentially (e.g., large bash outputs being accumulated).

---

### 3. 💰 Session Cost Estimation *(Medium effort, High value)*

**What:** Calculate and display cumulative API cost for the current session.

**Example output appended to `/context`:**
```
💰 Session cost estimate: $0.042
   Input:       $0.018  (18.2k tokens × $1.00/M)
   Output:      $0.015  (5.0k tokens × $3.00/M)
   Cache read:  $0.007  (70.0k tokens × $0.10/M)
   Cache write: $0.002  (2.0k tokens × $1.25/M)
```

**How:**
- `ctx.model.cost` has `{ input, output, cacheRead, cacheWrite }` per-token prices
- Iterate `ctx.sessionManager.getBranch()` to sum all `usage` fields (`inputTokens`, `outputTokens`, `cacheRead`, `cacheWrite`) across all assistant messages
- Multiply by per-token costs

**Why it matters:** API cost is a blind spot in most coding agent UIs. Showing running cost helps developers make informed decisions about session length, compaction timing, and model choice.

**Research note:** Tools like LiteLLM and PromptLayer show per-call cost breakdowns — none are surfaced inline in the agent chat. This would be a genuinely novel feature for a coding agent extension.

---

### 4. ⚠️ Context Overflow Warning (Auto-notify) *(Low effort, High value)*

**What:** Automatically warn the user when context fill crosses configurable thresholds (e.g., 70%, 85%, 95%).

**Example:**
```
⚠ Context window 85% full (170k/200k). Consider /context compact.
```

**How:**
- Subscribe to `pi.on("turn_end")`
- Compare `ctx.getContextUsage().percent` against thresholds
- Use `ctx.ui.notify(message, "warning")` to surface inline warnings
- Track which thresholds have already been notified per session to avoid repeated alerts

**Configuration idea:** Accept an options object when loading the extension: `{ warnAt: [0.70, 0.85, 0.95] }`.

**Why it matters:** Compaction happens silently. Users often don't realize they're at 90% until a compaction event disrupts their conversation. Proactive warnings give time to act.

---

### 5. 🔮 Compaction Proximity Predictor *(Low effort, Medium value)*

**What:** Based on per-turn growth history, predict how many more agent turns are likely before compaction is triggered.

**Example (appended below the grid):**
```
📉 Velocity: +2.3k tokens/turn avg
   ~38 turns until compaction (buffer boundary at 16.4k free)
```

**How:**
- Reuse the per-turn history array from Feature #2
- `turnsRemaining = Math.floor(freeTokens / avgTokensPerTurn)`
- Display alongside the grid in `/context` output

**Caveat:** Velocity varies widely (a single bash tool result can add 10k in one turn), so this should be clearly framed as a rough estimate.

---

### 6. 🔧 Tool Result Token Attribution *(Medium effort, Medium value)*

**What:** Show which tools are the biggest context consumers in the current session.

**Example:**
```
Top token consumers (this session):
  bash        ~45.2k tokens (38%)  [23 calls]
  read        ~28.1k tokens (23%)  [41 calls]
  web_search  ~19.4k tokens (16%)  [ 7 calls]
```

**How:**
- Subscribe to `pi.on("tool_result")` which fires with `{ toolName, content, isError }`
- Estimate tokens from `content.reduce((n, c) => n + c.text.length, 0) / 4` (chars-to-tokens approximation)
- Accumulate per-tool stats in a module-level `Map<string, { tokens: number, calls: number }>`
- Add a "Top consumers" section to `/context` output (or expose via a `/context tools` sub-command)

**Why it matters:** Large bash outputs and file reads are the primary culprits for context bloat. Making this visible helps developers decide when to truncate output, use `head`/`grep` in bash calls, etc.

---

### 7. 📐 Precise System Prompt Size *(Low effort, Medium value)*

**What:** Use the `before_agent_start` event — which has the full `systemPrompt` string — to measure the exact system prompt token contribution rather than relying on cache heuristics.

**How:**
- Subscribe to `pi.on("before_agent_start")` and store `Math.ceil(event.systemPrompt.length / 4)` as a token estimate
- Replace the cache-heuristic system/tools estimate when this data is available
- Could show a "system prompt: ~8.2k | tool defs: ~10.3k" breakdown if tool definition size can be inferred as the delta

**Why it matters:** The cache heuristic is a decent proxy but can be wrong early in a session (before caching warms up). The `before_agent_start` hook gives direct access to the actual system prompt text.

---

### 8. 🗜️ `/context compact` Sub-command *(Medium effort, High value)*

**What:** Add a `/context compact [instructions]` sub-command that triggers pi's context compaction on demand, with an optional focus instruction.

**Example:**
```
/context compact focus on the authentication module task
```

**How:**
- In the `/context` command handler, parse `args` for a `compact` sub-command keyword
- Call `ctx.compact({ customInstructions: args.slice("compact ".length).trim() || undefined })`
- Subscribe to `pi.on("session_compact")` to report before/after token counts in a success notification

**Why it matters:** The user currently has no programmatic way to trigger compaction from within the chat — this makes it a first-class action. Currently compaction only auto-triggers when approaching the buffer boundary.

---

### 9. ⌨️ Keyboard Shortcut *(Low effort, High value)*

**What:** Register a keyboard shortcut (e.g., `ctrl+shift+k`) to show context usage at any time without breaking flow to type `/context`.

**How:**
```ts
pi.registerShortcut("ctrl+shift+k", async (ctx) => {
  // same render logic as the /context command
});
```

**Why it matters:** Typing `/context` interrupts the editing flow. A hotkey allows quick glances at context fill the same way `ctrl+shift+g` shows git status in VS Code without opening the terminal.

---

### 10. 📦 Cache Efficiency Report *(Low effort, Medium value)*

**What:** Show how effectively the session is leveraging Anthropic prompt caching, and estimate the cost savings from it.

**Example:**
```
Cache efficiency (this session):
  Cache reads:   182.4k tokens  (saved ~$0.164 vs input pricing)
  Cache writes:    4.2k tokens
  Hit rate:        98% of turns had cache hits
```

**How:**
- Iterate `ctx.sessionManager.getBranch()` and sum all `usage.cacheRead` and `usage.cacheWrite` across assistant messages
- Compare `cacheRead` cost at `model.cost.cacheRead` rate vs what those tokens would cost at `model.cost.input` rate
- Report the savings

**Why it matters:** Cache efficiency directly impacts cost. If cache is not hitting (hit rate < 50%), it suggests the system prompt or tool definitions are changing between turns — often a bug or misconfiguration worth surfacing.

---

### 11. 🖥️ Adaptive Grid Width *(Low effort, Low value)*

**What:** Instead of a fixed 8×11 grid, auto-detect terminal width and use a wider layout on wide terminals (e.g., 5 rows × 20 cols), keeping total cell count at ~100 for consistent token-per-cell granularity.

**How:**
- Read `process.stdout.columns` at render time
- Calculate `cols = Math.min(Math.floor((terminalWidth - 20) / 2), 40)` (accounting for spacing)
- Keep `rows × cols ≈ 100`

**Why it matters:** On large monitors or split-pane terminals the current 8×11 grid uses only ~22 chars of width. A wider grid gives finer granularity and looks more polished at large sizes.

---

### 12. 🔄 Model Comparison View *(Medium effort, Low value)*

**What:** Show how the current token usage compares across different models' context windows, to inform model selection decisions.

**Example:**
```
Current usage (23.4k tokens) on other models:
  gemini-2.5-pro    (1,000k ctx)  ██░░░░░░░░░░░░░░░░░░  2%
  claude-sonnet-4-5   (200k ctx)  ████████░░░░░░░░░░░░  12%  ← current
  gpt-4o              (128k ctx)  ████████████░░░░░░░░  18%
  claude-haiku-3.5    (200k ctx)  ████████░░░░░░░░░░░░  12%
```

**How:**
- Maintain a small static lookup of popular model context window sizes
- Render mini ASCII progress bars for each model

**Why it matters:** Helps developers understand whether their current usage would be proportionally more or less on other models — useful when deciding to switch models mid-session.

---

### 13. 🔁 `/context watch` Toggle *(Medium effort, Medium value)*

**What:** A toggle sub-command that, when enabled, automatically appends a compact context summary after each assistant turn output.

```
/context watch on   # enable auto-display
/context watch off  # disable
```

**Compact per-turn summary format:**
```
[context: ◍◍◍●●·····○ 23k/200k 12%  +3.1k this turn]
```

**How:**
- Store a module-level `watchEnabled` boolean
- When enabled, subscribe to `turn_end` and call `ctx.ui.notify()` with a compact 1-line summary
- Combine with Feature #4 (overflow warnings) in the same `turn_end` handler

**Why it matters:** Combines the always-on awareness of Feature #1 (footer badge) with in-chat confirmation of context growth, for users who want more verbosity.

---

## Prioritised Summary

| # | Feature | Effort | Value | API hooks needed |
|---|---------|--------|-------|-----------------|
| 1 | Persistent footer badge | Low | ⭐⭐⭐⭐⭐ | `turn_end`, `ui.setStatus` |
| 4 | Context overflow warnings | Low | ⭐⭐⭐⭐⭐ | `turn_end`, `ui.notify` |
| 8 | `/context compact` sub-command | Medium | ⭐⭐⭐⭐⭐ | `ctx.compact`, `session_compact` |
| 9 | Keyboard shortcut | Low | ⭐⭐⭐⭐⭐ | `pi.registerShortcut` |
| 3 | Session cost estimation | Medium | ⭐⭐⭐⭐ | `model.cost`, session history |
| 2 | Token growth sparkline | Medium | ⭐⭐⭐⭐ | `turn_end`, session history |
| 5 | Compaction predictor | Low | ⭐⭐⭐ | turn history (from #2) |
| 6 | Tool token attribution | Medium | ⭐⭐⭐ | `tool_result` events |
| 7 | Precise system prompt size | Low | ⭐⭐⭐ | `before_agent_start` |
| 10 | Cache efficiency report | Low | ⭐⭐⭐ | session history, `model.cost` |
| 13 | `/context watch` toggle | Medium | ⭐⭐⭐ | `turn_end`, `ui.notify` |
| 11 | Adaptive grid width | Low | ⭐⭐ | `process.stdout.columns` |
| 12 | Model comparison view | Medium | ⭐⭐ | static lookup table |

---

## Recommended Next Steps

1. **Start with Features #1 + #4 together** — both are `turn_end` subscribers, can share a single event handler, and deliver the most visible value with least code (~30 lines each).
2. **Feature #8** (`/context compact`) — extends the existing command router and makes the extension actionable rather than purely observational.
3. **Feature #9** (keyboard shortcut) — one line of code, very high UX payoff.
4. **Features #2 + #5** (sparkline + predictor) — build together since the sparkline data also powers the predictor.
5. **Feature #3** (cost estimation) — the `model.cost` fields are already present on `ctx.model`; just needs accumulation logic over session history.
