import { describe, it, expect } from "bun:test";
import { AnthropicProvider, buildThinkingConfig } from "@/providers/anthropic.js";

describe("AnthropicProvider", () => {
  describe("constructor", () => {
    it("should initialize with config", () => {
      const provider = new AnthropicProvider({ apiKey: "test-key" });

      expect(provider).toBeDefined();
    });
  });

  describe("buildThinkingConfig", () => {
    it("should return undefined when disabled", () => {
      expect(buildThinkingConfig(false)).toBeUndefined();
    });

    it("should return config when enabled", () => {
      const result = buildThinkingConfig(true);
      expect(result).toEqual({ type: "enabled" as const, budget_tokens: 2000 });
    });

    it("should use custom budget when provided", () => {
      const result = buildThinkingConfig(true, 5000);
      expect(result?.budget_tokens).toBe(5000);
    });

    it("should use default budget when not provided", () => {
      const result = buildThinkingConfig(true);
      expect(result?.budget_tokens).toBe(2000);
    });
  });
});

describe("AnthropicProvider capabilities", () => {
  it("should return capabilities for known models", async () => {
    const provider = new AnthropicProvider({ apiKey: "test-key" });

    const capabilities = await provider.getCapabilities("claude-3-5-sonnet-20241022");

    expect(capabilities.modelName).toBe("claude-3-5-sonnet-20241022");
    expect(capabilities.supportsTools).toBe(true);
    expect(capabilities.supportsStreaming).toBe(true);
    expect(capabilities.supportsSystemPrompt).toBe(true);
    expect(capabilities.contextWindow).toBe(200000);
    expect(capabilities.maxOutputTokens).toBe(8192);
  });

  it("should cache capabilities", async () => {
    const provider = new AnthropicProvider({ apiKey: "test-key" });

    const caps1 = await provider.getCapabilities("claude-3-5-sonnet-20241022");
    const caps2 = await provider.getCapabilities("claude-3-5-sonnet-20241022");

    expect(caps1).toBe(caps2);
  });

  it("should warn for unknown models and use fallback context window", async () => {
    const provider = new AnthropicProvider({ apiKey: "test-key" });

    const capabilities = await provider.getCapabilities("unknown-model");

    expect(capabilities.modelName).toBe("unknown-model");
    expect(capabilities.contextWindow).toBe(200000); // fallback
  });

  it("should correctly report thinking support for different models", async () => {
    const provider = new AnthropicProvider({ apiKey: "test-key" });

    // Claude 3.5 models support thinking (per model registry)
    const caps = await provider.getCapabilities("claude-3-5-sonnet-20241022");
    expect(caps.supportsThinking).toBe(true);
  });
});
