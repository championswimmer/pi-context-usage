import {
  getSelectListTheme,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type AutocompleteItem,
  type Component,
  type TUI,
} from "@earendil-works/pi-tui";
import {
  computeSystemToolsSection,
  computeTurnBreakdown,
  formatConversationSection,
  formatSystemToolsSection,
  formatTurnTime,
  getActiveToolDetails,
  getTurnColor,
  getTurnIcon,
  type SystemToolsSection,
  type TurnBreakdown,
} from "./breakdown";
import { renderUsageSummary } from "./grid";
import {
  computeUsageBuckets,
  fmtTokens,
  formatInt,
  type UsageBuckets,
} from "./tokens";

type SectionKey = "systemPrompt" | "tools" | "conversation";

type VisibleRow =
  | { kind: "section"; key: SectionKey }
  | { kind: "systemPromptSummary" }
  | { kind: "systemPromptContent"; lineIndex: number }
  | { kind: "systemPromptNote" }
  | { kind: "tool"; index: number }
  | { kind: "toolDetail"; index: number; lineIndex: number }
  | { kind: "conversationTurn"; index: number }
  | { kind: "conversationDetail"; index: number; messageIndex: number };

function getContextCompletions(prefix: string): AutocompleteItem[] | null {
  const normalized = prefix.trim().toLowerCase();
  const value = "details";
  if (value.startsWith(normalized)) {
    return [{ value, label: value }];
  }
  return null;
}

function usageHint(): string {
  return "Usage: /context [details]";
}

function buildSummary(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext
): UsageBuckets | null {
  const usage = ctx.getContextUsage();
  if (!usage || !ctx.model) return null;

  const systemPrompt = ctx.getSystemPrompt();
  const systemPromptTokens = Math.ceil(systemPrompt.length / 4);

  const activeTools = getActiveToolDetails(pi);
  const toolTokens = activeTools.reduce((sum, tool) => {
    const nameDesc = tool.name.length + (tool.description || "").length;
    const paramsStr = JSON.stringify(tool.parameters ?? {});
    return sum + Math.ceil((nameDesc + paramsStr.length) / 4);
  }, 0);

  return computeUsageBuckets(
    usage,
    ctx.sessionManager.getBranch(),
    ctx.model,
    systemPromptTokens,
    toolTokens
  );
}

function notifySummary(
  ctx: ExtensionCommandContext,
  buckets: UsageBuckets,
  _pi?: ExtensionAPI
): void {
  ctx.ui.notify(["", ...renderUsageSummary(buckets, ctx.ui.theme), ""].join("\n"), "info");
}

function notifyPlainDetails(
  ctx: ExtensionCommandContext,
  buckets: UsageBuckets,
  systemTools: SystemToolsSection,
  turns: TurnBreakdown[]
): void {
  const lines = [
    "",
    ...renderUsageSummary(buckets, ctx.ui.theme),
    "",
    ...formatSystemToolsSection(systemTools, ctx.ui.theme),
    "",
    ...formatConversationSection(turns, ctx.ui.theme, 30),
    "",
  ];
  ctx.ui.notify(lines.join("\n"), "info");
}

function renderFocusedLine(selectTheme: ReturnType<typeof getSelectListTheme>, text: string): string {
  return `${selectTheme.selectedPrefix("› ")}${selectTheme.selectedText(text)}`;
}

function renderPlainLine(indent: number, text: string): string {
  return `${" ".repeat(indent)}${text}`;
}

/** Wrap an array of content lines in a Unicode rounded-corner box. */
function wrapInBox(
  lines: string[],
  width: number,
  colorFn: (s: string) => string,
  title?: string
): string[] {
  const inner = Math.max(2, width - 2); // space inside │…│

  // Top bar: ╭── title ──╮
  const topFill = title
    ? (() => {
        const label = ` ${title} `;
        const remain = Math.max(0, inner - label.length);
        const left = Math.floor(remain / 2);
        const right = remain - left;
        return `${"─".repeat(left)}${label}${"─".repeat(right)}`;
      })()
    : "─".repeat(inner);
  const top = colorFn(`╭${topFill}╮`);
  const bottom = colorFn(`╰${"─".repeat(inner)}╯`);

  const boxed = lines.map((line) => {
    const vw = visibleWidth(line);
    const pad = Math.max(0, inner - vw);
    return colorFn("│") + line + " ".repeat(pad) + colorFn("│");
  });

  return [top, ...boxed, bottom];
}

class ContextDetailsOverlay implements Component {
  private readonly selectTheme = getSelectListTheme();
  private readonly sectionExpanded: Record<SectionKey, boolean> = {
    systemPrompt: true,
    tools: true,
    conversation: true,
  };
  private readonly expandedTools = new Set<number>();
  private readonly expandedTurns = new Set<number>();
  private expandedSystemPromptContent = false;
  private readonly systemPromptLines: string[];
  private focusIndex = 0;
  private scrollOffset = 0;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly buckets: UsageBuckets,
    private readonly systemTools: SystemToolsSection,
    private readonly turns: TurnBreakdown[],
    private readonly done: (result: void) => void
  ) {
    this.systemPromptLines = systemTools.systemPrompt.text.split("\n");
  }

  invalidate(): void {}

  private getVisibleRows(): VisibleRow[] {
    const rows: VisibleRow[] = [{ kind: "section", key: "systemPrompt" }];

    if (this.sectionExpanded.systemPrompt) {
      rows.push({ kind: "systemPromptSummary" });
      if (this.expandedSystemPromptContent) {
        this.systemPromptLines.forEach((_, lineIndex) => {
          rows.push({ kind: "systemPromptContent", lineIndex });
        });
      }
      if (
        this.systemTools.cachedTokens !== null &&
        this.systemTools.cachedTokens !== this.systemTools.totalTokens
      ) {
        rows.push({ kind: "systemPromptNote" });
      }
    }

    rows.push({ kind: "section", key: "tools" });
    if (this.sectionExpanded.tools) {
      this.systemTools.tools.forEach((tool, index) => {
        rows.push({ kind: "tool", index });
        if (this.expandedTools.has(index)) {
          tool.schemaPreviewLines.forEach((_, lineIndex) => {
            rows.push({ kind: "toolDetail", index, lineIndex });
          });
        }
      });
    }

    rows.push({ kind: "section", key: "conversation" });
    if (this.sectionExpanded.conversation) {
      this.turns.forEach((_, index) => {
        rows.push({ kind: "conversationTurn", index });
        if (this.expandedTurns.has(index)) {
          this.turns[index].messages.forEach((_, messageIndex) => {
            rows.push({ kind: "conversationDetail", index, messageIndex });
          });
        }
      });
    }

    return rows;
  }

  private clampFocus(rows: VisibleRow[]): void {
    if (rows.length === 0) {
      this.focusIndex = 0;
      this.scrollOffset = 0;
      return;
    }
    if (this.focusIndex < 0) this.focusIndex = 0;
    if (this.focusIndex >= rows.length) this.focusIndex = rows.length - 1;
  }

  private getBodyHeight(): number {
    const overlayHeight = Math.max(16, Math.floor(this.tui.terminal.rows * 0.9));
    const reserved = renderUsageSummary(this.buckets, this.theme).length + 8;
    return Math.max(8, overlayHeight - reserved);
  }

  private keepFocusVisible(bodyHeight: number): void {
    if (this.focusIndex < this.scrollOffset) {
      this.scrollOffset = this.focusIndex;
    } else if (this.focusIndex >= this.scrollOffset + bodyHeight) {
      this.scrollOffset = this.focusIndex - bodyHeight + 1;
    }
    if (this.scrollOffset < 0) this.scrollOffset = 0;
  }

  private moveToSection(direction: 1 | -1): void {
    const rows = this.getVisibleRows();
    const sectionIndices = rows
      .map((row, index) => ({ row, index }))
      .filter((entry) => entry.row.kind === "section")
      .map((entry) => entry.index);

    if (sectionIndices.length === 0) return;

    let currentSection = sectionIndices.findIndex((index) => index === this.focusIndex);
    if (currentSection === -1) {
      currentSection = sectionIndices.findIndex((index) => index > this.focusIndex);
      if (currentSection === -1) currentSection = 0;
    }

    const nextIndex = (currentSection + direction + sectionIndices.length) % sectionIndices.length;
    this.focusIndex = sectionIndices[nextIndex];
  }

  private toggleFocusedRow(expandOnly = false): void {
    const rows = this.getVisibleRows();
    const row = rows[this.focusIndex];
    if (!row) return;

    switch (row.kind) {
      case "section":
        this.sectionExpanded[row.key] = expandOnly ? true : !this.sectionExpanded[row.key];
        return;
      case "systemPromptSummary":
        if (expandOnly) this.expandedSystemPromptContent = true;
        else this.expandedSystemPromptContent = !this.expandedSystemPromptContent;
        return;
      case "tool":
        if (expandOnly) this.expandedTools.add(row.index);
        else if (this.expandedTools.has(row.index)) this.expandedTools.delete(row.index);
        else this.expandedTools.add(row.index);
        return;
      case "conversationTurn":
        if (expandOnly) this.expandedTurns.add(row.index);
        else if (this.expandedTurns.has(row.index)) this.expandedTurns.delete(row.index);
        else this.expandedTurns.add(row.index);
        return;
      default:
        return;
    }
  }

  private collapseFocusedRow(): void {
    const rows = this.getVisibleRows();
    const row = rows[this.focusIndex];
    if (!row) return;

    switch (row.kind) {
      case "section":
        this.sectionExpanded[row.key] = false;
        return;
      case "systemPromptSummary":
        this.expandedSystemPromptContent = false;
        return;
      case "systemPromptContent": {
        this.expandedSystemPromptContent = false;
        const parentIndex = rows.findIndex((candidate) => candidate.kind === "systemPromptSummary");
        if (parentIndex >= 0) this.focusIndex = parentIndex;
        return;
      }
      case "tool":
        this.expandedTools.delete(row.index);
        return;
      case "conversationTurn":
        this.expandedTurns.delete(row.index);
        return;
      case "toolDetail": {
        this.expandedTools.delete(row.index);
        const parentIndex = rows.findIndex(
          (candidate) => candidate.kind === "tool" && candidate.index === row.index
        );
        if (parentIndex >= 0) this.focusIndex = parentIndex;
        return;
      }
      case "conversationDetail": {
        this.expandedTurns.delete(row.index);
        const parentIndex = rows.findIndex(
          (candidate) => candidate.kind === "conversationTurn" && candidate.index === row.index
        );
        if (parentIndex >= 0) this.focusIndex = parentIndex;
        return;
      }
      default:
        return;
    }
  }

  handleInput(data: string): void {
    const rows = this.getVisibleRows();
    this.clampFocus(rows);
    const bodyHeight = this.getBodyHeight();

    if (matchesKey(data, Key.escape) || data === "q") {
      this.done(undefined);
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.focusIndex -= 1;
    } else if (matchesKey(data, Key.down)) {
      this.focusIndex += 1;
    } else if (matchesKey(data, Key.enter) || matchesKey(data, Key.right)) {
      this.toggleFocusedRow(true);
    } else if (matchesKey(data, Key.left)) {
      this.collapseFocusedRow();
    } else if (matchesKey(data, Key.tab)) {
      this.moveToSection(1);
    } else if (matchesKey(data, Key.shift("tab"))) {
      this.moveToSection(-1);
    } else if (matchesKey(data, "pageUp")) {
      this.focusIndex -= bodyHeight;
    } else if (matchesKey(data, "pageDown")) {
      this.focusIndex += bodyHeight;
    } else if (matchesKey(data, Key.home)) {
      this.focusIndex = 0;
    } else if (matchesKey(data, Key.end)) {
      this.focusIndex = rows.length - 1;
    } else {
      return;
    }

    const nextRows = this.getVisibleRows();
    this.clampFocus(nextRows);
    this.keepFocusVisible(bodyHeight);
    this.tui.requestRender();
  }

  private sectionTitle(key: SectionKey): string {
    switch (key) {
      case "systemPrompt":
        return `System Prompt  ${fmtTokens(this.systemTools.systemPrompt.tokens)} tokens est. (${formatInt(this.systemTools.systemPrompt.chars)} chars)`;
      case "tools":
        return `Tools (${this.systemTools.tools.length})  ${fmtTokens(
          this.systemTools.tools.reduce((sum, tool) => sum + tool.totalTokens, 0)
        )} tokens est.`;
      case "conversation":
        return `Conversation (${this.turns.filter((turn) => turn.kind === "turn").length} turns)  ${fmtTokens(
          this.turns.reduce((sum, turn) => sum + turn.tokens, 0)
        )} tokens est.`;
    }
  }

  private renderRow(row: VisibleRow, isFocused: boolean, width: number): string {
    const lineWidth = Math.max(10, width);
    let text = "";
    let indent = 0;

    switch (row.kind) {
      case "section": {
        const expanded = this.sectionExpanded[row.key];
        text = `${expanded ? "▾" : "▸"} ${this.sectionTitle(row.key)}`;
        break;
      }
      case "systemPromptSummary": {
        indent = 2;
        const spExpanded = this.expandedSystemPromptContent;
        const spLabel = `System prompt: ${fmtTokens(this.systemTools.systemPrompt.tokens)} tokens (${formatInt(
          this.systemTools.systemPrompt.chars
        )} chars)`;
        text = `${spExpanded ? "▾" : "▸"} ${this.theme.bold(this.theme.fg("accent", spLabel))}`;
        break;
      }
      case "systemPromptContent": {
        indent = 4;
        text = this.theme.fg("muted", this.systemPromptLines[row.lineIndex] ?? "");
        break;
      }
      case "systemPromptNote": {
        indent = 4;
        text = this.theme.fg(
          "muted",
          `Visible parts: ${fmtTokens(this.systemTools.totalTokens)} tokens est. vs ${fmtTokens(
            this.systemTools.cachedTokens ?? 0
          )} cached prompt tokens in the top summary; provider-side envelopes and cached context are not visible to the extension.`
        );
        break;
      }
      case "tool": {
        indent = 2;
        const tool = this.systemTools.tools[row.index];
        const expanded = this.expandedTools.has(row.index);
        text = `${expanded ? "▾" : "▸"} ${this.theme.fg("accent", tool.name)}  ${this.theme.bold(
          fmtTokens(tool.totalTokens)
        )}  ${this.theme.fg("muted", `${formatInt(tool.totalChars)} chars`)}`;
        break;
      }
      case "toolDetail": {
        indent = 6;
        const tool = this.systemTools.tools[row.index];
        text = this.theme.fg("muted", tool.schemaPreviewLines[row.lineIndex] || "");
        break;
      }
      case "conversationTurn": {
        indent = 2;
        const turn = this.turns[row.index];
        const expanded = this.expandedTurns.has(row.index);
        const prefix = turn.kind === "compaction" ? "Σ" : `#${turn.turnNumber}`;
        const icon = this.theme.bold(this.theme.fg(getTurnColor(turn), getTurnIcon(turn)));
        text = `${expanded ? "▾" : "▸"} ${prefix}  ${formatTurnTime(turn.timestamp)}  ${icon}  ${turn.preview}  ${this.theme.bold(
          fmtTokens(turn.tokens)
        )}  ${this.theme.fg("muted", `${fmtTokens(turn.cumulativeTokens)} cum est`)}`;
        break;
      }
      case "conversationDetail": {
        indent = 6;
        const message = this.turns[row.index].messages[row.messageIndex];
        text = `${this.theme.bold(message.label)}  ${fmtTokens(message.tokens)}  ${this.theme.fg(
          "muted",
          message.preview
        )}`;
        break;
      }
    }

    const rendered = renderPlainLine(indent, text);
    const finalLine = isFocused ? renderFocusedLine(this.selectTheme, rendered) : rendered;
    return truncateToWidth(finalLine, lineWidth);
  }

  render(width: number): string[] {
    const innerWidth = Math.max(10, width - 2); // subtract 2 for box side borders
    const summaryLines = renderUsageSummary(this.buckets, this.theme);
    const rows = this.getVisibleRows();
    this.clampFocus(rows);

    const bodyHeight = this.getBodyHeight();
    this.keepFocusVisible(bodyHeight);

    const visibleRows = rows.slice(this.scrollOffset, this.scrollOffset + bodyHeight);
    const bodyLines = visibleRows.map((row, visibleIndex) =>
      this.renderRow(row, this.scrollOffset + visibleIndex === this.focusIndex, innerWidth)
    );

    while (bodyLines.length < bodyHeight) bodyLines.push("");

    const innerLines: string[] = [
      ...summaryLines.map((line) => truncateToWidth(line, innerWidth)),
      "",
      this.theme.fg("muted", `${rows.length} rows · focus ${this.focusIndex + 1}/${rows.length}`),
      ...bodyLines,
      "",
      truncateToWidth(
        this.theme.fg(
          "muted",
          "↑/↓ move  Enter/→ expand  ← collapse  Tab jump sections  PgUp/PgDn scroll  Home/End  Esc/q close"
        ),
        innerWidth
      ),
    ];

    return wrapInBox(innerLines, width, (s) => this.theme.fg("border", s), "Context Details");
  }
}

async function showDetails(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const buckets = buildSummary(pi, ctx);
  if (!buckets) {
    ctx.ui.notify("No context usage data available. Send a message first.", "warning");
    return;
  }

  const systemTools = computeSystemToolsSection(ctx, pi);
  const turns = computeTurnBreakdown(ctx.sessionManager.getBranch());

  if (!ctx.hasUI) {
    notifyPlainDetails(ctx, buckets, systemTools, turns);
    return;
  }

  await ctx.ui.custom<void>(
    (tui, theme, _keybindings, done) =>
      new ContextDetailsOverlay(tui, theme, buckets, systemTools, turns, done),
    {
      overlay: true,
      overlayOptions: {
        width: "90%",
        maxHeight: "90%",
        anchor: "center",
      },
    }
  );
}

export function registerContextCommand(pi: ExtensionAPI) {
  pi.registerCommand("context", {
    description: "Show context usage summary or /context details breakdown",
    getArgumentCompletions: getContextCompletions,
    handler: async (args, ctx) => {
      const normalized = args.trim().toLowerCase();

      const buckets = buildSummary(pi, ctx);
      if (!buckets) {
        ctx.ui.notify("No context usage data available. Send a message first.", "warning");
        return;
      }

      if (!normalized) {
        notifySummary(ctx, buckets);
        return;
      }

      if (normalized === "details") {
        await showDetails(pi, ctx);
        return;
      }

      ctx.ui.notify(usageHint(), "warning");
    },
  });
}
