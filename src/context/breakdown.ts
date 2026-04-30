import {
  estimateTokens,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type SessionEntry,
  type Theme,
  type ToolInfo,
} from "@mariozechner/pi-coding-agent";
import { fmtTokens, formatInt, getCachedSystemToolsTokens } from "./tokens";

export type ToolBreakdown = {
  name: string;
  description: string;
  descTokens: number;
  paramsTokens: number;
  totalTokens: number;
  totalChars: number;
  schemaPreviewLines: string[];
};

export type SystemToolsSection = {
  systemPrompt: {
    tokens: number;
    chars: number;
    text: string;
  };
  tools: ToolBreakdown[];
  totalTokens: number;
  totalChars: number;
  cachedTokens: number | null;
};

export type TurnMessageDetail = {
  id: string;
  role:
    | "user"
    | "assistant"
    | "toolResult"
    | "bashExecution"
    | "custom"
    | "compactionSummary";
  label: string;
  preview: string;
  tokens: number;
  chars: number;
  timestamp: string;
};

export type TurnBreakdown = {
  id: string;
  kind: "turn" | "compaction";
  turnNumber: number | null;
  timestamp: string;
  preview: string;
  tokens: number;
  chars: number;
  cumulativeTokens: number;
  messages: TurnMessageDetail[];
  toolHeavy: boolean;
  dominantRole: TurnMessageDetail["role"] | "compactionSummary";
};

export function computeSystemPromptTokens(text: string): {
  tokens: number;
  chars: number;
  text: string;
} {
  return {
    tokens: Math.ceil(text.length / 4),
    chars: text.length,
    text,
  };
}

export function computeToolBreakdown(activeTools: ToolInfo[]): ToolBreakdown[] {
  return [...activeTools]
    .map((tool) => {
      const name = tool.name;
      const description = tool.description || "";
      const descChars = name.length + description.length;
      const paramsText = JSON.stringify(tool.parameters ?? {}, null, 2);
      const paramsChars = paramsText.length;
      const descTokens = Math.ceil(descChars / 4);
      const paramsTokens = Math.ceil(paramsChars / 4);

      return {
        name,
        description,
        descTokens,
        paramsTokens,
        totalTokens: descTokens + paramsTokens,
        totalChars: descChars + paramsChars,
        schemaPreviewLines: paramsText.split("\n").slice(0, 10),
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens || a.name.localeCompare(b.name));
}

export function getActiveToolDetails(pi: ExtensionAPI): ToolInfo[] {
  const activeNames = new Set(pi.getActiveTools());
  return pi.getAllTools().filter((tool) => activeNames.has(tool.name));
}

export function computeSystemToolsSection(
  ctx: Pick<ExtensionCommandContext, "getSystemPrompt" | "sessionManager">,
  pi: ExtensionAPI
): SystemToolsSection {
  const systemPrompt = computeSystemPromptTokens(ctx.getSystemPrompt());
  const tools = computeToolBreakdown(getActiveToolDetails(pi));
  const toolsTokens = tools.reduce((sum, tool) => sum + tool.totalTokens, 0);
  const toolsChars = tools.reduce((sum, tool) => sum + tool.totalChars, 0);

  return {
    systemPrompt,
    tools,
    totalTokens: systemPrompt.tokens + toolsTokens,
    totalChars: systemPrompt.chars + toolsChars,
    cachedTokens: getCachedSystemToolsTokens(ctx.sessionManager.getBranch()),
  };
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const block of content as any[]) {
    if (block?.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    } else if (block?.type === "thinking" && typeof block.thinking === "string") {
      parts.push(`[thinking] ${block.thinking}`);
    } else if (block?.type === "toolCall") {
      parts.push(`[tool:${block.name}] ${JSON.stringify(block.arguments ?? {})}`);
    } else if (block?.type === "image") {
      parts.push("[image]");
    }
  }
  return parts.join(" ");
}

function truncateSnippet(text: string, max = 80): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (!singleLine) return "(no text)";
  return singleLine.length <= max ? singleLine : `${singleLine.slice(0, max - 1)}…`;
}

function roleLabel(role: TurnMessageDetail["role"]): string {
  switch (role) {
    case "user":
      return "user";
    case "assistant":
      return "assistant";
    case "toolResult":
      return "tool";
    case "bashExecution":
      return "bash";
    case "custom":
      return "custom";
    case "compactionSummary":
      return "compact";
  }
}

function entryToMessageDetail(entry: SessionEntry): TurnMessageDetail | null {
  if (entry.type === "message") {
    const message = entry.message as any;
    let previewSource = "";
    let chars = 0;

    switch (message.role) {
      case "user":
      case "assistant":
      case "toolResult":
      case "custom": {
        previewSource = contentToText(message.content);
        chars = previewSource.length;
        break;
      }
      case "bashExecution": {
        previewSource = `${message.command}\n${message.output}`;
        chars = previewSource.length;
        break;
      }
      case "compactionSummary": {
        previewSource = message.summary || "";
        chars = previewSource.length;
        break;
      }
      default:
        return null;
    }

    return {
      id: entry.id,
      role: message.role,
      label: roleLabel(message.role),
      preview: truncateSnippet(previewSource, 120),
      tokens: estimateTokens(message),
      chars,
      timestamp: entry.timestamp,
    };
  }

  if (entry.type === "custom_message") {
    const content = entry.content;
    const previewSource = contentToText(content);
    const syntheticMessage = {
      role: "custom",
      content,
      display: entry.display,
      details: entry.details,
      customType: entry.customType,
      timestamp: Date.parse(entry.timestamp),
    } as any;

    return {
      id: entry.id,
      role: "custom",
      label: roleLabel("custom"),
      preview: truncateSnippet(previewSource, 120),
      tokens: estimateTokens(syntheticMessage),
      chars: previewSource.length,
      timestamp: entry.timestamp,
    };
  }

  if (entry.type === "compaction") {
    const previewSource = entry.summary || "";
    const syntheticMessage = {
      role: "compactionSummary",
      summary: entry.summary,
      tokensBefore: entry.tokensBefore,
      timestamp: Date.parse(entry.timestamp),
    } as any;

    return {
      id: entry.id,
      role: "compactionSummary",
      label: roleLabel("compactionSummary"),
      preview: truncateSnippet(previewSource, 120),
      tokens: estimateTokens(syntheticMessage),
      chars: previewSource.length,
      timestamp: entry.timestamp,
    };
  }

  return null;
}

function buildTurnPreview(details: TurnMessageDetail[]): string {
  const preferred = details.find((detail) => detail.role === "user") ?? details[0];
  return preferred ? truncateSnippet(preferred.preview, 80) : "(empty turn)";
}

function determineDominantRole(
  details: TurnMessageDetail[]
): TurnBreakdown["dominantRole"] {
  if (details.some((detail) => detail.role === "compactionSummary")) {
    return "compactionSummary";
  }
  if (details.some((detail) => detail.role === "user")) return "user";
  if (details.some((detail) => detail.role === "assistant")) return "assistant";
  if (details.some((detail) => detail.role === "toolResult")) return "toolResult";
  if (details.some((detail) => detail.role === "bashExecution")) return "bashExecution";
  return details[0]?.role ?? "assistant";
}

function finalizeTurn(turn: Omit<TurnBreakdown, "cumulativeTokens" | "toolHeavy" | "dominantRole">): TurnBreakdown {
  const toolTokens = turn.messages
    .filter((message) => message.role === "toolResult" || message.role === "bashExecution")
    .reduce((sum, message) => sum + message.tokens, 0);

  return {
    ...turn,
    preview: buildTurnPreview(turn.messages),
    cumulativeTokens: 0,
    toolHeavy: turn.tokens > 0 ? toolTokens > turn.tokens / 2 : false,
    dominantRole: determineDominantRole(turn.messages),
  };
}

export function computeTurnBreakdown(branch: SessionEntry[]): TurnBreakdown[] {
  const turns: TurnBreakdown[] = [];
  let currentTurn: Omit<TurnBreakdown, "cumulativeTokens" | "toolHeavy" | "dominantRole"> | null = null;
  let turnNumber = 0;

  const pushCurrentTurn = () => {
    if (!currentTurn) return;
    turns.push(finalizeTurn(currentTurn));
    currentTurn = null;
  };

  for (const entry of branch) {
    if (entry.type === "compaction") {
      pushCurrentTurn();
      const compactionDetail = entryToMessageDetail(entry);
      if (!compactionDetail) continue;
      turns.push({
        id: `compaction-${entry.id}`,
        kind: "compaction",
        turnNumber: null,
        timestamp: entry.timestamp,
        preview: truncateSnippet(entry.summary || "", 80),
        tokens: compactionDetail.tokens,
        chars: compactionDetail.chars,
        cumulativeTokens: 0,
        messages: [compactionDetail],
        toolHeavy: false,
        dominantRole: "compactionSummary",
      });
      continue;
    }

    const detail = entryToMessageDetail(entry);
    if (!detail) continue;

    if (detail.role === "user") {
      pushCurrentTurn();
      turnNumber += 1;
      currentTurn = {
        id: `turn-${entry.id}`,
        kind: "turn",
        turnNumber,
        timestamp: entry.timestamp,
        preview: detail.preview,
        tokens: 0,
        chars: 0,
        messages: [],
      };
    }

    if (!currentTurn) {
      turnNumber += 1;
      currentTurn = {
        id: `turn-${entry.id}`,
        kind: "turn",
        turnNumber,
        timestamp: entry.timestamp,
        preview: detail.preview,
        tokens: 0,
        chars: 0,
        messages: [],
      };
    }

    currentTurn.messages.push(detail);
    currentTurn.tokens += detail.tokens;
    currentTurn.chars += detail.chars;
  }

  pushCurrentTurn();

  let cumulativeTokens = 0;
  for (const turn of turns) {
    cumulativeTokens += turn.tokens;
    turn.cumulativeTokens = cumulativeTokens;
  }

  return turns;
}

export function estimateBreakdownTokens(branch: SessionEntry[]): number {
  return computeTurnBreakdown(branch).reduce((sum, turn) => sum + turn.tokens, 0);
}

export function formatTurnTime(timestamp: string): string {
  const date = new Date(timestamp);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function getTurnIcon(turn: TurnBreakdown): string {
  if (turn.kind === "compaction") return "Σ";
  if (turn.toolHeavy) return "⚙";
  switch (turn.dominantRole) {
    case "user":
      return "U";
    case "assistant":
      return "A";
    case "toolResult":
      return "T";
    case "bashExecution":
      return "!";
    case "custom":
      return "C";
    case "compactionSummary":
      return "Σ";
  }
}

export function getTurnColor(turn: TurnBreakdown): "accent" | "success" | "warning" | "muted" {
  if (turn.kind === "compaction") return "muted";
  if (turn.toolHeavy) return "warning";
  switch (turn.dominantRole) {
    case "user":
      return "accent";
    case "assistant":
      return "success";
    case "toolResult":
    case "bashExecution":
      return "warning";
    default:
      return "muted";
  }
}

function padRight(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function padLeft(text: string, width: number): string {
  return text.length >= width ? text : " ".repeat(width - text.length) + text;
}

export function formatSystemToolsSection(section: SystemToolsSection, theme: Theme): string[] {
  const nameWidth = Math.max(
    "Tool".length,
    ...section.tools.map((tool) => tool.name.length),
    "System prompt".length
  );
  const tokenWidth = Math.max(
    "Tokens".length,
    ...section.tools.map((tool) => fmtTokens(tool.totalTokens).length),
    fmtTokens(section.systemPrompt.tokens).length,
    fmtTokens(section.totalTokens).length
  );
  const charWidth = Math.max(
    "Chars".length,
    ...section.tools.map((tool) => formatInt(tool.totalChars).length),
    formatInt(section.systemPrompt.chars).length,
    formatInt(section.totalChars).length
  );

  const lines = [
    theme.bold("System / Tools Details"),
    "",
    `${padRight("Item", nameWidth)}  ${padLeft("Tokens", tokenWidth)}  ${padLeft("Chars", charWidth)}`,
    `${theme.bold(theme.fg("accent", padRight("System prompt", nameWidth)))}  ${theme.bold(
      padLeft(fmtTokens(section.systemPrompt.tokens), tokenWidth)
    )}  ${padLeft(formatInt(section.systemPrompt.chars), charWidth)}`,
  ];

  if (section.tools.length === 0) {
    lines.push(theme.fg("muted", "No active tools."));
  } else {
    for (const tool of section.tools) {
      lines.push(
        `${theme.fg("accent", padRight(tool.name, nameWidth))}  ${padLeft(
          fmtTokens(tool.totalTokens),
          tokenWidth
        )}  ${padLeft(formatInt(tool.totalChars), charWidth)}`
      );
    }
  }

  lines.push(
    `${theme.bold(padRight("Total visible parts", nameWidth))}  ${theme.bold(
      padLeft(fmtTokens(section.totalTokens), tokenWidth)
    )}  ${padLeft(formatInt(section.totalChars), charWidth)}`
  );

  if (section.cachedTokens !== null && section.cachedTokens !== section.totalTokens) {
    lines.push("");
    lines.push(
      theme.fg(
        "muted",
        `Note: visible parts sum to ${fmtTokens(section.totalTokens)} tokens, while the last assistant cache reported ${fmtTokens(section.cachedTokens)} tokens. The cache number includes provider-side scaffolding that extensions cannot inspect.`
      )
    );
  }

  return lines;
}

export function formatConversationSection(
  turns: TurnBreakdown[],
  theme: Theme,
  maxRows = turns.length
): string[] {
  const visibleTurns = turns.slice(0, maxRows);
  const tokenWidth = Math.max(
    "Tokens".length,
    ...visibleTurns.map((turn) => fmtTokens(turn.tokens).length),
    ...visibleTurns.map((turn) => fmtTokens(turn.cumulativeTokens).length)
  );

  const lines = [theme.bold(`Conversation (${turns.filter((turn) => turn.kind === "turn").length} turns)`), ""];

  for (const turn of visibleTurns) {
    const prefix = turn.kind === "compaction" ? "Σ" : `#${turn.turnNumber}`;
    const icon = theme.bold(theme.fg(getTurnColor(turn), getTurnIcon(turn)));
    lines.push(
      `${padLeft(prefix, 3)}  ${formatTurnTime(turn.timestamp)}  ${icon}  ${turn.preview}  ${theme.bold(
        padLeft(fmtTokens(turn.tokens), tokenWidth)
      )}  ${theme.fg("muted", `${padLeft(fmtTokens(turn.cumulativeTokens), tokenWidth)} cum`)}`
    );
  }

  if (turns.length > maxRows) {
    lines.push("");
    lines.push(theme.fg("muted", `… ${turns.length - maxRows} more turns`));
  }

  return lines;
}
