import assert from "node:assert/strict";
import registerExtension, {
  computeToolBreakdown,
  computeTurnBreakdown,
  estimateBreakdownTokens,
} from "../src/index";

const mode = process.argv[2] === "details" ? "details" : "summary";
const outputs: string[] = [];

const mockTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

const mockTools = [
  {
    name: "read",
    description: "Read file contents with offset and limit support.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        offset: { type: "number" },
        limit: { type: "number" },
      },
      required: ["path"],
    },
    sourceInfo: { path: "<builtin:read>", source: "builtin", scope: "temporary", origin: "top-level" },
  },
  {
    name: "bash",
    description: "Execute shell commands and return stdout and stderr.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeout: { type: "number" },
      },
      required: ["command"],
    },
    sourceInfo: { path: "<builtin:bash>", source: "builtin", scope: "temporary", origin: "top-level" },
  },
  {
    name: "edit",
    description: "Make precise edits to existing files using exact replacements.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        edits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              oldText: { type: "string" },
              newText: { type: "string" },
            },
            required: ["oldText", "newText"],
          },
        },
      },
      required: ["path", "edits"],
    },
    sourceInfo: { path: "<builtin:edit>", source: "builtin", scope: "temporary", origin: "top-level" },
  },
  {
    name: "web_search",
    description: "Search the web and synthesize an answer with citations.",
    parameters: {
      type: "object",
      properties: {
        queries: { type: "array", items: { type: "string" } },
        numResults: { type: "number" },
        provider: { type: "string", enum: ["auto", "perplexity", "exa"] },
      },
    },
    sourceInfo: { path: "<builtin:web_search>", source: "builtin", scope: "temporary", origin: "top-level" },
  },
  {
    name: "context_tree_query",
    description: "Retrieve previously pruned tool outputs by tool call id.",
    parameters: {
      type: "object",
      properties: {
        toolCallIds: { type: "array", items: { type: "string" } },
      },
      required: ["toolCallIds"],
    },
    sourceInfo: { path: "<builtin:context_tree_query>", source: "builtin", scope: "temporary", origin: "top-level" },
  },
] as const;

const mockBranch = [
  {
    id: "u1",
    parentId: null,
    timestamp: "2026-04-30T10:00:00.000Z",
    type: "message",
    message: {
      role: "user",
      content: "Can you inspect the repo and summarize how /context currently works?",
    },
  },
  {
    id: "a1",
    parentId: "u1",
    timestamp: "2026-04-30T10:00:10.000Z",
    type: "message",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "I will inspect the main source file and README first." },
        { type: "toolCall", name: "read", arguments: { path: "src/index.ts" } },
      ],
      stopReason: "tool_use",
      usage: {
        input: 12000,
        output: 800,
        cacheRead: 9600,
        cacheWrite: 1400,
        totalTokens: 13800,
      },
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    },
  },
  {
    id: "t1",
    parentId: "a1",
    timestamp: "2026-04-30T10:00:12.000Z",
    type: "message",
    message: {
      role: "toolResult",
      toolName: "read",
      content: [{ type: "text", text: "src/index.ts contains the /context and /release commands in one file." }],
    },
  },
  {
    id: "u2",
    parentId: "t1",
    timestamp: "2026-04-30T10:01:00.000Z",
    type: "message",
    message: {
      role: "user",
      content: "Now sketch a plan for a /context details mode with a deeper breakdown.",
    },
  },
  {
    id: "a2",
    parentId: "u2",
    timestamp: "2026-04-30T10:01:20.000Z",
    type: "message",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "I'll propose a phased plan covering routing, token math, UI, and docs." }],
      stopReason: "stop",
      usage: {
        input: 18000,
        output: 1200,
        cacheRead: 11000,
        cacheWrite: 1600,
        totalTokens: 19800,
      },
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    },
  },
  {
    id: "u3",
    parentId: "a2",
    timestamp: "2026-04-30T10:05:00.000Z",
    type: "message",
    message: {
      role: "user",
      content: "Implement the refactor baseline first, then continue step by step.",
    },
  },
  {
    id: "a3",
    parentId: "u3",
    timestamp: "2026-04-30T10:05:30.000Z",
    type: "message",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "I'll split the code into context and release modules and keep the grid unchanged." },
        { type: "toolCall", name: "edit", arguments: { path: "src/index.ts", edits: [{ oldText: "foo", newText: "bar" }] } },
      ],
      stopReason: "tool_use",
      usage: {
        input: 22000,
        output: 1400,
        cacheRead: 11800,
        cacheWrite: 1700,
        totalTokens: 25100,
      },
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    },
  },
  {
    id: "t3",
    parentId: "a3",
    timestamp: "2026-04-30T10:05:36.000Z",
    type: "message",
    message: {
      role: "toolResult",
      toolName: "edit",
      content: [{ type: "text", text: "Updated src/index.ts and extracted shared helpers." }],
    },
  },
  {
    id: "c1",
    parentId: "t3",
    timestamp: "2026-04-30T10:06:00.000Z",
    type: "compaction",
    summary: "Earlier discussion established the design for /context details, including system prompt tokens, per-tool estimates, and per-turn conversation grouping.",
    firstKeptEntryId: "u2",
    tokensBefore: 42000,
  },
  {
    id: "u4",
    parentId: "c1",
    timestamp: "2026-04-30T10:10:00.000Z",
    type: "message",
    message: {
      role: "user",
      content: "Add the system prompt and active-tools breakdown next.",
    },
  },
  {
    id: "a4",
    parentId: "u4",
    timestamp: "2026-04-30T10:10:20.000Z",
    type: "message",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "I'll compute visible system prompt chars and estimate each active tool schema separately." },
        { type: "toolCall", name: "read", arguments: { path: "docs/extensions.md" } },
      ],
      stopReason: "tool_use",
      usage: {
        input: 26000,
        output: 900,
        cacheRead: 11900,
        cacheWrite: 1850,
        totalTokens: 28750,
      },
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    },
  },
  {
    id: "t4",
    parentId: "a4",
    timestamp: "2026-04-30T10:10:25.000Z",
    type: "message",
    message: {
      role: "toolResult",
      toolName: "read",
      content: [{ type: "text", text: "extensions.md confirms getSystemPrompt(), getAllTools(), and getActiveTools()." }],
    },
  },
  {
    id: "u5",
    parentId: "t4",
    timestamp: "2026-04-30T10:14:00.000Z",
    type: "message",
    message: {
      role: "user",
      content: "Great. Now add the conversation breakdown grouped per user turn.",
    },
  },
  {
    id: "a5",
    parentId: "u5",
    timestamp: "2026-04-30T10:14:25.000Z",
    type: "message",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "I'll compute one line per turn, add cumulative totals, and include compacted summaries." }],
      stopReason: "stop",
      usage: {
        input: 29000,
        output: 1100,
        cacheRead: 12100,
        cacheWrite: 1900,
        totalTokens: 32000,
      },
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    },
  },
  {
    id: "u6",
    parentId: "a5",
    timestamp: "2026-04-30T10:18:00.000Z",
    type: "message",
    message: {
      role: "user",
      content: "Finish with docs and tests once the new command works.",
    },
  },
  {
    id: "a6",
    parentId: "u6",
    timestamp: "2026-04-30T10:18:40.000Z",
    type: "message",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "I'll update README, AGENTS.md, and add a mock details test script." }],
      stopReason: "stop",
      usage: {
        input: 31000,
        output: 900,
        cacheRead: 12250,
        cacheWrite: 2050,
        totalTokens: 34200,
      },
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    },
  },
] as const;

const systemPrompt = [
  "You are pi, a coding agent.",
  "Keep responses concise and grounded in repository files.",
  "Use read before edit, and explain the work clearly.",
  "When context gets large, compact completed batches.",
  "Prefer active tools only, and avoid guessing APIs.",
  "Follow repository-specific instructions from AGENTS.md and loaded skills.",
].join("\n\n").repeat(22);

const toolBreakdown = computeToolBreakdown([...(mockTools as any)]);
assert.ok(toolBreakdown[0].totalTokens >= toolBreakdown[1].totalTokens, "tools should be sorted descending by total tokens");

const turns = computeTurnBreakdown([...mockBranch] as any);
assert.equal(
  turns.filter((turn) => turn.kind === "turn").length,
  mockBranch.filter((entry) => entry.type === "message" && entry.message.role === "user").length,
  "turn count should match number of user messages"
);
assert.equal(
  turns.reduce((sum, turn) => sum + turn.tokens, 0),
  estimateBreakdownTokens([...mockBranch] as any),
  "turn totals should match estimated branch token sum"
);

const commands = new Map<string, Function>();
const mockPi = {
  registerCommand: (name: string, command: { handler: Function }) => {
    commands.set(name, command.handler);
  },
  getActiveTools: () => mockTools.map((tool) => tool.name),
  getAllTools: () => [...(mockTools as any)],
};

const mockCtx = {
  hasUI: false,
  getContextUsage: () => ({
    contextWindow: 200_000,
    tokens: 31_400,
    percent: 15.7,
  }),
  getSystemPrompt: () => systemPrompt,
  model: {
    id: "claude-sonnet-4-5",
    maxTokens: 16_384,
  },
  sessionManager: {
    getBranch: () => [...mockBranch],
  },
  ui: {
    theme: mockTheme,
    notify: (text: string) => {
      outputs.push(text);
    },
  },
};

registerExtension(mockPi as any);

const contextHandler = commands.get("context");
if (!contextHandler) {
  throw new Error("context command was not registered");
}

await contextHandler(mode === "details" ? "details" : "", mockCtx as any);

for (const output of outputs) {
  console.log("--- OUTPUT START ---");
  console.log(output);
  console.log("--- OUTPUT END ---");
}
