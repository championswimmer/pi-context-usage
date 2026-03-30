import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * pi-context-usage extension
 *
 * Registers a `/context` command that displays a visual context window
 * usage diagram similar to the Copilot coding agent style:
 *
 *   ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉
 *   ● ● ● ● · · · · · · ·
 *   · · · · · · · · · · ·
 *           ◎ ◎ ◎ ◎ ◎ ◎ ◎
 *   ◎ ◎ ◎ ◎ ◎ ◎ ◎ ◎ ◎ ◎ ◎
 */
export default function (pi: ExtensionAPI) {
  pi.registerCommand("context", {
    description: "Show context window usage visualization",
    handler: async (_args, ctx) => {
      const usage = ctx.getContextUsage();
      const model = ctx.model;

      if (!usage || !model) {
        ctx.ui.notify(
          "No context usage data available. Send a message first.",
          "warning"
        );
        return;
      }

      const contextWindow = usage.contextWindow;
      const usedTokens = usage.tokens;
      const maxOutputTokens = model.maxTokens || 0;

      // Try to get breakdown from last assistant message usage
      let systemToolsTokens = 0;
      let messageTokens = 0;

      const entries = ctx.sessionManager.getBranch();
      let lastAssistantUsage: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        totalTokens: number;
      } | null = null;

      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (
          entry.type === "message" &&
          entry.message.role === "assistant" &&
          "usage" in entry.message
        ) {
          const assistant = entry.message as any;
          if (
            assistant.stopReason !== "aborted" &&
            assistant.stopReason !== "error" &&
            assistant.usage
          ) {
            lastAssistantUsage = assistant.usage;
            break;
          }
        }
      }

      // Use cache tokens as proxy for system/tools (cached content = system prompt + tools)
      if (lastAssistantUsage && usedTokens !== null) {
        const cacheTokens =
          (lastAssistantUsage.cacheRead || 0) +
          (lastAssistantUsage.cacheWrite || 0);
        if (cacheTokens > 0) {
          systemToolsTokens = cacheTokens;
          messageTokens = Math.max(0, usedTokens - cacheTokens);
        } else {
          // No cache info — estimate ~15% for system/tools
          systemToolsTokens = Math.round(usedTokens * 0.15);
          messageTokens = usedTokens - systemToolsTokens;
        }
      } else if (usedTokens !== null) {
        systemToolsTokens = Math.round(usedTokens * 0.15);
        messageTokens = usedTokens - systemToolsTokens;
      }

      const bufferTokens = maxOutputTokens;
      const freeTokens =
        usedTokens !== null
          ? Math.max(0, contextWindow - usedTokens - bufferTokens)
          : contextWindow - bufferTokens;

      // --- Build the visual dot grid ---
      const COLS = 11;
      const ROWS = 8;
      const TOTAL_CELLS = ROWS * COLS;

      // Symbols
      const SYM_SYSTEM = "◉";
      const SYM_MESSAGE = "●";
      const SYM_FREE = "·";
      const SYM_BUFFER = "◎";

      // Calculate cell counts
      let systemCells = Math.round(
        (systemToolsTokens / contextWindow) * TOTAL_CELLS
      );
      let messageCells = Math.round(
        (messageTokens / contextWindow) * TOTAL_CELLS
      );
      let bufferCells = Math.round(
        (bufferTokens / contextWindow) * TOTAL_CELLS
      );

      // Ensure at least 1 cell for non-zero values
      if (systemToolsTokens > 0 && systemCells === 0) systemCells = 1;
      if (messageTokens > 0 && messageCells === 0) messageCells = 1;
      if (bufferTokens > 0 && bufferCells === 0) bufferCells = 1;

      // Free cells fill the rest
      let freeCells = TOTAL_CELLS - systemCells - messageCells - bufferCells;
      if (freeCells < 0) {
        // Clamp: reduce buffer first, then free
        bufferCells = Math.max(0, bufferCells + freeCells);
        freeCells = 0;
      }

      // Build flat cell array
      const cells: string[] = [];
      for (let i = 0; i < systemCells; i++) cells.push(SYM_SYSTEM);
      for (let i = 0; i < messageCells; i++) cells.push(SYM_MESSAGE);
      for (let i = 0; i < freeCells; i++) cells.push(SYM_FREE);
      for (let i = 0; i < bufferCells; i++) cells.push(SYM_BUFFER);

      // Ensure exactly TOTAL_CELLS
      while (cells.length < TOTAL_CELLS) cells.splice(cells.length - bufferCells, 0, SYM_FREE);
      while (cells.length > TOTAL_CELLS) cells.pop();

      const theme = ctx.ui.theme;

      function colorCell(sym: string): string {
        switch (sym) {
          case SYM_SYSTEM:
            return theme.fg("accent", sym);
          case SYM_MESSAGE:
            return theme.fg("success", sym);
          case SYM_FREE:
            return theme.fg("dim", sym);
          case SYM_BUFFER:
            return theme.fg("warning", sym);
          default:
            return sym;
        }
      }

      // Render grid with indentation for partial rows at section boundaries
      const gridLines: string[] = [];
      for (let row = 0; row < ROWS; row++) {
        const start = row * COLS;
        const rowCells = cells.slice(start, start + COLS);

        // Check if this row is at the boundary where buffer starts
        // If buffer doesn't start at col 0 of this row, indent it
        const bufferStartIdx = TOTAL_CELLS - bufferCells;
        const rowStartIdx = row * COLS;
        const rowEndIdx = rowStartIdx + COLS;

        if (
          bufferStartIdx > rowStartIdx &&
          bufferStartIdx < rowEndIdx &&
          rowCells.some((c) => c === SYM_BUFFER)
        ) {
          // This row has a transition into buffer mid-row
          const offset = bufferStartIdx - rowStartIdx;
          const indent = "  ".repeat(offset);
          const bufferPart = rowCells.slice(offset);
          gridLines.push(indent + bufferPart.map(colorCell).join(" "));
        } else {
          gridLines.push(rowCells.map(colorCell).join(" "));
        }
      }

      // --- Format numbers ---
      function fmtTokens(n: number): string {
        if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "m";
        if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
        return n.toString();
      }

      const modelName = model.id || model.name || "unknown";
      const percentStr =
        usage.percent !== null ? `${Math.round(usage.percent)}%` : "?%";
      const usedStr = usedTokens !== null ? fmtTokens(usedTokens) : "?";

      const pct = (n: number) =>
        contextWindow > 0
          ? ((n / contextWindow) * 100).toFixed(0)
          : "0";

      // --- Assemble output ---
      const lines: string[] = [
        "",
        theme.bold("Context Usage"),
        "",
        ...gridLines,
        "",
        `${theme.fg("muted", modelName)}   ${usedStr} / ${fmtTokens(contextWindow)} tokens (${percentStr})`,
        "",
        `${theme.fg("accent", SYM_SYSTEM)} System/Tools: ${fmtTokens(systemToolsTokens).padStart(7)} (${pct(systemToolsTokens)}%)`,
        `${theme.fg("success", SYM_MESSAGE)} Messages:     ${fmtTokens(messageTokens).padStart(7)} (${pct(messageTokens)}%)`,
        `${theme.fg("dim", SYM_FREE)} Free Space:   ${fmtTokens(Math.max(0, freeTokens)).padStart(7)} (${pct(Math.max(0, freeTokens))}%)`,
        `${theme.fg("warning", SYM_BUFFER)} Buffer:       ${fmtTokens(bufferTokens).padStart(7)} (${pct(bufferTokens)}%)`,
        "",
      ];

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
