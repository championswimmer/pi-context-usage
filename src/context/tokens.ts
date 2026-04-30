import type { ContextUsage, SessionEntry, Theme } from "@mariozechner/pi-coding-agent";

export const GRID_COLS = 11;
export const GRID_ROWS = 8;
export const GRID_TOTAL_CELLS = GRID_COLS * GRID_ROWS;

export const SYM_SYSTEM = "◍";
export const SYM_MESSAGE = "●";
export const SYM_FREE = "·";
export const SYM_BUFFER = "○";

export type AssistantUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
};

export type UsageBuckets = {
  contextWindow: number;
  usedTokens: number | null;
  percent: number | null;
  modelName: string;
  systemToolsTokens: number;
  messageTokens: number;
  freeTokens: number;
  bufferTokens: number;
  cachedSystemToolsTokens: number | null;
};

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

export function formatInt(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function getLastAssistantUsage(entries: SessionEntry[]): AssistantUsage | null {
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
        return assistant.usage as AssistantUsage;
      }
    }
  }
  return null;
}

export function getCachedSystemToolsTokens(entries: SessionEntry[]): number | null {
  const usage = getLastAssistantUsage(entries);
  if (!usage) return null;
  const cacheTokens = (usage.cacheRead || 0) + (usage.cacheWrite || 0);
  return cacheTokens > 0 ? cacheTokens : null;
}

export function computeUsageBuckets(
  usage: ContextUsage,
  entries: SessionEntry[],
  model: { id?: string; name?: string; maxTokens?: number } | undefined
): UsageBuckets {
  const contextWindow = usage.contextWindow;
  const usedTokens = usage.tokens;
  const usedTokensOrZero = usedTokens ?? 0;
  const bufferTokens = model?.maxTokens || 0;
  const cachedSystemToolsTokens = getCachedSystemToolsTokens(entries);

  let systemToolsTokens = 0;
  let messageTokens = 0;

  if (cachedSystemToolsTokens !== null) {
    systemToolsTokens = cachedSystemToolsTokens;
    messageTokens = Math.max(0, usedTokensOrZero - cachedSystemToolsTokens);
  } else if (usedTokens !== null) {
    systemToolsTokens = Math.round(usedTokens * 0.15);
    messageTokens = usedTokens - systemToolsTokens;
  }

  const freeTokens = Math.max(0, contextWindow - usedTokensOrZero - bufferTokens);

  return {
    contextWindow,
    usedTokens,
    percent: usage.percent,
    modelName: model?.id || model?.name || "unknown",
    systemToolsTokens,
    messageTokens,
    freeTokens,
    bufferTokens,
    cachedSystemToolsTokens,
  };
}

export function buildGridCells(buckets: UsageBuckets): string[] {
  const { contextWindow, systemToolsTokens, messageTokens, bufferTokens } = buckets;

  let systemCells = Math.round((systemToolsTokens / contextWindow) * GRID_TOTAL_CELLS);
  let messageCells = Math.round((messageTokens / contextWindow) * GRID_TOTAL_CELLS);
  let bufferCells = Math.round((bufferTokens / contextWindow) * GRID_TOTAL_CELLS);

  if (systemToolsTokens > 0 && systemCells === 0) systemCells = 1;
  if (messageTokens > 0 && messageCells === 0) messageCells = 1;
  if (bufferTokens > 0 && bufferCells === 0) bufferCells = 1;

  let freeCells = GRID_TOTAL_CELLS - systemCells - messageCells - bufferCells;
  if (freeCells < 0) {
    bufferCells = Math.max(0, bufferCells + freeCells);
    freeCells = 0;
  }

  const cells: string[] = [];
  for (let i = 0; i < systemCells; i++) cells.push(SYM_SYSTEM);
  for (let i = 0; i < messageCells; i++) cells.push(SYM_MESSAGE);
  for (let i = 0; i < freeCells; i++) cells.push(SYM_FREE);
  for (let i = 0; i < bufferCells; i++) cells.push(SYM_BUFFER);

  while (cells.length < GRID_TOTAL_CELLS) {
    cells.splice(cells.length - bufferCells, 0, SYM_FREE);
  }
  while (cells.length > GRID_TOTAL_CELLS) cells.pop();

  return cells;
}

export function colorCell(sym: string, theme: Theme): string {
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
