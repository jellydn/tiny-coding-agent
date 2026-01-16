import { describe, it, expect, beforeEach, afterEach } from "bun:test";

const tempConfigDir = "/tmp/test-tiny-agent-config";
const tempConfigFile = `${tempConfigDir}/config.yaml`;

beforeEach(() => {
  import("node:fs").then((fs) => {
    fs.mkdirSync(tempConfigDir, { recursive: true });
    fs.writeFileSync(
      tempConfigFile,
      `defaultModel: llama3.2
conversationFile: /tmp/conversation.json
memoryFile: /tmp/memory.json
maxContextTokens: 128000
maxMemoryTokens: 10000
`,
      "utf-8",
    );
  });
  delete process.env.TINY_AGENT_MODEL;
  delete process.env.TINY_AGENT_SYSTEM_PROMPT;
  delete process.env.TINY_AGENT_CONVERSATION_FILE;
  delete process.env.TINY_AGENT_MEMORY_FILE;
  delete process.env.TINY_AGENT_MAX_CONTEXT_TOKENS;
  delete process.env.TINY_AGENT_MAX_MEMORY_TOKENS;
});

afterEach(() => {
  import("node:fs").then((fs) => {
    try {
      fs.rmSync(tempConfigDir, { recursive: true });
    } catch {}
  });
  delete process.env.TINY_AGENT_MODEL;
  delete process.env.TINY_AGENT_SYSTEM_PROMPT;
  delete process.env.TINY_AGENT_CONVERSATION_FILE;
  delete process.env.TINY_AGENT_MEMORY_FILE;
  delete process.env.TINY_AGENT_MAX_CONTEXT_TOKENS;
  delete process.env.TINY_AGENT_MAX_MEMORY_TOKENS;
});

describe("Config Loader - Env Var Override Loop", () => {
  it("should override model from TINY_AGENT_MODEL env var", async () => {
    process.env.TINY_AGENT_MODEL = "claude-3-5-sonnet";
    const { loadConfig } = await import("./loader.js");
    const config = loadConfig();
    expect(config.defaultModel).toBe("claude-3-5-sonnet");
  });

  it("should override system prompt from TINY_AGENT_SYSTEM_PROMPT env var", async () => {
    process.env.TINY_AGENT_SYSTEM_PROMPT = "Custom system prompt";
    const { loadConfig } = await import("./loader.js");
    const config = loadConfig();
    expect(config.systemPrompt).toBe("Custom system prompt");
  });

  it("should reject empty string env var values", async () => {
    process.env.TINY_AGENT_SYSTEM_PROMPT = "";
    const { loadConfig } = await import("./loader.js");
    const config = loadConfig();
    expect(config.systemPrompt).not.toBe("");
  });

  it("should parse numeric env vars correctly", async () => {
    process.env.TINY_AGENT_MAX_CONTEXT_TOKENS = "64000";
    const { loadConfig } = await import("./loader.js");
    const config = loadConfig();
    expect(config.maxContextTokens).toBe(64000);
  });

  it("should ignore invalid numeric env vars", async () => {
    process.env.TINY_AGENT_MAX_CONTEXT_TOKENS = "invalid";
    const { loadConfig } = await import("./loader.js");
    const config = loadConfig();
    expect(config.maxContextTokens).toBeUndefined();
  });

  it("should ignore negative numeric env vars", async () => {
    process.env.TINY_AGENT_MAX_MEMORY_TOKENS = "-100";
    const { loadConfig } = await import("./loader.js");
    const config = loadConfig();
    expect(config.maxMemoryTokens).toBeUndefined();
  });
});
