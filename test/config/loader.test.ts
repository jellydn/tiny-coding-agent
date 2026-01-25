import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { homedir } from "node:os";

const require = createRequire(import.meta.url);
const CONFIG_INDEX_PATH = require.resolve("../../src/config/index.ts");

const tempConfigDir = "/tmp/test-tiny-agent-config";
const tempConfigFile = `${tempConfigDir}/config.yaml`;

// Save original values
const originalYamlPath = process.env.TINY_AGENT_CONFIG_YAML;
const originalJsonPath = process.env.TINY_AGENT_CONFIG_JSON;

beforeEach(() => {
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
  // Override config paths to use temp directory
  process.env.TINY_AGENT_CONFIG_YAML = tempConfigFile;
  delete process.env.TINY_AGENT_CONFIG_JSON;
  delete process.env.TINY_AGENT_MODEL;
  delete process.env.TINY_AGENT_SYSTEM_PROMPT;
  delete process.env.TINY_AGENT_CONVERSATION_FILE;
  delete process.env.TINY_AGENT_MEMORY_FILE;
  delete process.env.TINY_AGENT_MAX_CONTEXT_TOKENS;
  delete process.env.TINY_AGENT_MAX_MEMORY_TOKENS;
});

afterEach(() => {
  try {
    fs.rmSync(tempConfigDir, { recursive: true });
  } catch {}
  // Restore original values
  if (originalYamlPath !== undefined) {
    process.env.TINY_AGENT_CONFIG_YAML = originalYamlPath;
  } else {
    delete process.env.TINY_AGENT_CONFIG_YAML;
  }
  if (originalJsonPath !== undefined) {
    process.env.TINY_AGENT_CONFIG_JSON = originalJsonPath;
  } else {
    delete process.env.TINY_AGENT_CONFIG_JSON;
  }
  delete process.env.TINY_AGENT_MODEL;
  delete process.env.TINY_AGENT_SYSTEM_PROMPT;
  delete process.env.TINY_AGENT_CONVERSATION_FILE;
  delete process.env.TINY_AGENT_MEMORY_FILE;
  delete process.env.TINY_AGENT_MAX_CONTEXT_TOKENS;
  delete process.env.TINY_AGENT_MAX_MEMORY_TOKENS;
});

describe("Config Loader - Config Merging", () => {
  it("should merge defaults with existing config for skillDirectories", async () => {
    const { loadConfig } = await import(CONFIG_INDEX_PATH);
    const config = loadConfig();
    // Should have default skillDirectories even if not in config file
    expect(config.skillDirectories).toBeDefined();
    expect(config.skillDirectories).toContain(join(homedir(), ".tiny-agent/skills/"));
    expect(config.skillDirectories).toContain("./.skills/");
  });

  it("should merge defaults with existing config for mcpServers", async () => {
    const { loadConfig } = await import(CONFIG_INDEX_PATH);
    const config = loadConfig();
    // Should have default MCP servers even if not in config file
    expect(config.mcpServers).toBeDefined();
    expect(config.mcpServers?.context7).toBeDefined();
    expect(config.mcpServers?.context7?.command).toBe("npx");
  });

  it("should only use user-configured mcpServers, not merge with defaults", async () => {
    // Config with only context7 - no serena since it's opt-in
    fs.writeFileSync(
      tempConfigFile,
      `defaultModel: custom-model
mcpServers:
  context7:
    command: npx
    args: ["-y", "@upstash/context7-mcp"]
`,
      "utf-8",
    );

    const { loadConfig } = await import(CONFIG_INDEX_PATH);
    const config = loadConfig();
    // Only user's configured servers should be present
    expect(Object.keys(config.mcpServers!)).toEqual(["context7"]);
    expect(config.mcpServers?.context7).toBeDefined();
  });

  it("should preserve user-configured values over defaults", async () => {
    // Update config with custom model
    fs.writeFileSync(
      tempConfigFile,
      `defaultModel: custom-model
skillDirectories:
  - /custom/skills
`,
      "utf-8",
    );

    const { loadConfig } = await import(CONFIG_INDEX_PATH);
    const config = loadConfig();
    // User config should take precedence
    expect(config.defaultModel).toBe("custom-model");
    // But missing fields should use defaults
    expect(config.systemPrompt).toBeDefined();
  });

  it("should deep merge providers object", async () => {
    fs.writeFileSync(
      tempConfigFile,
      `defaultModel: custom-model
providers:
  openai:
    apiKey: my-key
`,
      "utf-8",
    );

    const { loadConfig } = await import(CONFIG_INDEX_PATH);
    const config = loadConfig();
    // OpenAI provider should be preserved
    expect(config.providers.openai?.apiKey).toBe("my-key");
    // Ollama should still have default from defaults
    expect(config.providers.ollama).toBeDefined();
  });
});

describe("Config Loader - Env Var Override Loop", () => {
  it("should override model from TINY_AGENT_MODEL env var", async () => {
    process.env.TINY_AGENT_MODEL = "claude-3-5-sonnet";
    const { loadConfig } = await import(CONFIG_INDEX_PATH);
    const config = loadConfig();
    expect(config.defaultModel).toBe("claude-3-5-sonnet");
  });

  it("should override system prompt from TINY_AGENT_SYSTEM_PROMPT env var", async () => {
    process.env.TINY_AGENT_SYSTEM_PROMPT = "Custom system prompt";
    const { loadConfig } = await import(CONFIG_INDEX_PATH);
    const config = loadConfig();
    expect(config.systemPrompt).toBe("Custom system prompt");
  });

  it("should reject empty string env var values", async () => {
    process.env.TINY_AGENT_SYSTEM_PROMPT = "";
    const { loadConfig } = await import(CONFIG_INDEX_PATH);
    const config = loadConfig();
    expect(config.systemPrompt).not.toBe("");
  });

  it("should parse numeric env vars correctly", async () => {
    process.env.TINY_AGENT_MAX_CONTEXT_TOKENS = "64000";
    const { loadConfig } = await import(CONFIG_INDEX_PATH);
    const config = loadConfig();
    expect(config.maxContextTokens).toBe(64000);
  });

  it("should ignore invalid numeric env vars and use config file value", async () => {
    process.env.TINY_AGENT_MAX_CONTEXT_TOKENS = "invalid";
    const { loadConfig } = await import(CONFIG_INDEX_PATH);
    const config = loadConfig();
    // Invalid env var is ignored, uses config file value
    expect(config.maxContextTokens).toBe(128000);
  });

  it("should ignore negative numeric env vars and use config file value", async () => {
    process.env.TINY_AGENT_MAX_MEMORY_TOKENS = "-100";
    const { loadConfig } = await import(CONFIG_INDEX_PATH);
    const config = loadConfig();
    // Negative env var is ignored, uses config file value
    expect(config.maxMemoryTokens).toBe(10000);
  });
});
