import registerContext from "../src/index";

const outputs: string[] = [];

const mockTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

const mockCtx = {
  getContextUsage: () => ({
    contextWindow: 400_000,
    tokens: 3,
    percent: 0.00075,
  }),
  model: {
    id: "gpt-5.2-codex",
    maxTokens: 128_000,
  },
  sessionManager: {
    getBranch: () => [
      {
        type: "message",
        message: {
          role: "assistant",
          stopReason: "stop",
          usage: {
            input: 3,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 3,
          },
        },
      },
    ],
  },
  ui: {
    theme: mockTheme,
    notify: (text: string) => {
      outputs.push(text);
    },
  },
};

const mockPi = {
  registerCommand: (_name: string, { handler }: { handler: Function }) => {
    handler([], mockCtx);
  },
};

registerContext(mockPi as any);

for (const output of outputs) {
  console.log("--- OUTPUT START ---");
  console.log(output);
  console.log("--- OUTPUT END ---");
}
