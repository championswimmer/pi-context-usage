import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  GRID_COLS,
  GRID_ROWS,
  SYM_BUFFER,
  SYM_FREE,
  SYM_MESSAGE,
  SYM_SYSTEM,
  SYM_TOOL,
  buildGridCells,
  colorCell,
  fmtTokens,
  type UsageBuckets,
} from "./tokens";

export function renderGrid(buckets: UsageBuckets, theme: Theme): string[] {
  const cells = buildGridCells(buckets);
  const lines: string[] = [];

  for (let row = 0; row < GRID_ROWS; row++) {
    const start = row * GRID_COLS;
    const rowCells = cells.slice(start, start + GRID_COLS);
    lines.push(rowCells.map((cell) => colorCell(cell, theme)).join(" "));
  }

  return lines;
}

export function renderUsageSummary(buckets: UsageBuckets, theme: Theme): string[] {
  const usedStr = buckets.usedTokens !== null ? fmtTokens(buckets.usedTokens) : "?";
  const percentStr =
    buckets.percent !== null ? `${Math.round(buckets.percent)}%` : "?%";
  const pct = (n: number) =>
    buckets.contextWindow > 0
      ? `${Math.round((n / buckets.contextWindow) * 100)}%`
      : "0%";

  return [
    theme.bold("Context Usage"),
    "",
    ...renderGrid(buckets, theme),
    "",
    `${theme.fg("muted", buckets.modelName)}   ${usedStr} / ${fmtTokens(
      buckets.contextWindow
    )} tokens (${percentStr})`,
    "",
    `${theme.fg("accent", SYM_SYSTEM)} System Prompt: ${fmtTokens(
      buckets.systemPromptTokens
    ).padStart(7)} (${pct(buckets.systemPromptTokens)})`,
    `${theme.fg("muted", SYM_TOOL)} Tools:          ${fmtTokens(
      buckets.toolTokens
    ).padStart(7)} (${pct(buckets.toolTokens)})`,
    `${theme.fg("success", SYM_MESSAGE)} Messages:      ${fmtTokens(
      buckets.messageTokens
    ).padStart(7)} (${pct(buckets.messageTokens)})`,
    `${theme.fg("dim", SYM_FREE)} Empty:          ${fmtTokens(buckets.freeTokens).padStart(
      7
    )} (${pct(buckets.freeTokens)})`,
    `${theme.fg("warning", SYM_BUFFER)} Buffer:         ${fmtTokens(
      buckets.bufferTokens
    ).padStart(7)} (${pct(buckets.bufferTokens)})`,
  ];
}
