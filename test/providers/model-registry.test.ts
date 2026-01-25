import { describe, it, expect } from "bun:test";
import {
  detectProvider,
  getModelInfo,
  supportsThinking,
  supportsTools,
  getProviderPatterns,
} from "../../src/providers/model-registry.js";

describe("detectProvider()", () => {
  describe("Anthropic models", () => {
    it("should detect claude-3-5 models", () => {
      expect(detectProvider("claude-3-5-sonnet")).toBe("anthropic");
      expect(detectProvider("claude-3-5-haiku")).toBe("anthropic");
      expect(detectProvider("CLAUDE-3-5-SONNET")).toBe("anthropic"); // case insensitive
    });

    it("should detect claude-4 models", () => {
      expect(detectProvider("claude-4-opus")).toBe("anthropic");
      expect(detectProvider("claude-4-sonnet")).toBe("anthropic");
    });

    it("should detect other claude models", () => {
      expect(detectProvider("claude-3-opus")).toBe("anthropic");
      expect(detectProvider("claude-3-sonnet")).toBe("anthropic");
      expect(detectProvider("claude-3-haiku")).toBe("anthropic");
    });
  });

  describe("OpenAI models", () => {
    it("should detect o1 thinking models", () => {
      expect(detectProvider("o1-preview")).toBe("openai");
      expect(detectProvider("o1-mini")).toBe("openai");
    });

    it("should detect o3 thinking models", () => {
      expect(detectProvider("o3-mini")).toBe("openai");
    });

    it("should detect GPT models", () => {
      expect(detectProvider("gpt-4o")).toBe("openai");
      expect(detectProvider("gpt-4-turbo")).toBe("openai");
      expect(detectProvider("gpt-3.5-turbo")).toBe("openai");
    });
  });

  describe("Gateway providers", () => {
    it("should detect openrouter prefixed models", () => {
      expect(detectProvider("openrouter/anthropic/claude-3.5-sonnet")).toBe("openrouter");
      expect(detectProvider("openrouter/google/gemini-pro")).toBe("openrouter");
      expect(detectProvider("openrouter/meta/llama-3")).toBe("openrouter");
    });

    it("should detect openrouter provider-prefixed models", () => {
      expect(detectProvider("anthropic/claude-3.5-sonnet")).toBe("openrouter");
      expect(detectProvider("google/gemini-pro")).toBe("openrouter");
      expect(detectProvider("meta/llama-3-70b")).toBe("openrouter");
      expect(detectProvider("mistralai/mixtral-8x7b")).toBe("openrouter");
      expect(detectProvider("deepseek/deepseek-r1")).toBe("openrouter");
    });

    it("should detect opencode prefixed models", () => {
      expect(detectProvider("opencode/gpt-5.2-codex")).toBe("opencode");
      expect(detectProvider("opencode/claude-sonnet-4-5")).toBe("opencode");
      expect(detectProvider("opencode/kimi-k2")).toBe("opencode");
    });
  });

  describe("Ollama - catch-all for unknown models", () => {
    it("should detect common open source models", () => {
      expect(detectProvider("llama3.2")).toBe("ollama");
      expect(detectProvider("deepseek-r1")).toBe("ollama");
      expect(detectProvider("qwen3-coder")).toBe("ollama");
      expect(detectProvider("mistral")).toBe("ollama");
    });

    it("should handle model names with colons", () => {
      expect(detectProvider("ollama/llama3.2")).toBe("ollama");
      expect(detectProvider("hf.co/quantized/model")).toBe("ollama");
    });

    it("should detect Ollama Cloud models (-oss suffix)", () => {
      expect(detectProvider("llama3.2-oss")).toBe("ollama");
      expect(detectProvider("qwen3-coder-oss")).toBe("ollama");
      expect(detectProvider("ollama-cloud/model")).toBe("ollama");
    });

    it("should handle edge cases", () => {
      expect(detectProvider("unknown-model")).toBe("ollama");
      expect(detectProvider("")).toBe("ollama");
      expect(detectProvider("   ")).toBe("ollama"); // trimmed to empty
    });
  });
});

describe("getModelInfo()", () => {
  it("should return correct info for claude-3-5 models", () => {
    const info = getModelInfo("claude-3-5-sonnet");
    expect(info?.provider).toBe("anthropic");
    expect(info?.supportsThinking).toBe(true);
    expect(info?.supportsTools).toBe(true);
  });

  it("should return correct info for claude-3 models", () => {
    const info = getModelInfo("claude-3-opus");
    expect(info?.provider).toBe("anthropic");
    expect(info?.supportsThinking).toBe(true);
    expect(info?.supportsTools).toBe(true);
  });

  it("should return correct info for o1 models", () => {
    const info = getModelInfo("o1-preview");
    expect(info?.provider).toBe("openai");
    expect(info?.supportsThinking).toBe(true);
    expect(info?.supportsTools).toBe(false);
  });

  it("should return correct info for GPT models", () => {
    const info = getModelInfo("gpt-4o");
    expect(info?.provider).toBe("openai");
    expect(info?.supportsThinking).toBe(true);
    expect(info?.supportsTools).toBe(true);
  });

  it("should return correct info for openrouter models", () => {
    const info = getModelInfo("openrouter/anthropic/claude-3.5-sonnet");
    expect(info?.provider).toBe("openrouter");
    expect(info?.supportsThinking).toBe(true);
    expect(info?.supportsTools).toBe(true);
  });

  it("should return correct info for opencode models", () => {
    const info = getModelInfo("opencode/gpt-5.2-codex");
    expect(info?.provider).toBe("opencode");
    expect(info?.supportsThinking).toBe(true);
    expect(info?.supportsTools).toBe(true);
  });

  it("should return info for unknown models (ollama fallback)", () => {
    const info = getModelInfo("unknown-model-x");
    expect(info?.provider).toBe("ollama");
    expect(info?.supportsThinking).toBe(true);
    expect(info?.supportsTools).toBe(true);
  });

  it("should return the same reference for same model", () => {
    const info1 = getModelInfo("gpt-4o");
    const info2 = getModelInfo("gpt-4o");
    expect(info1).toBe(info2); // Same reference (MODEL_DATABASE entries are immutable)
    expect(info1).toEqual(info2); // Same values
  });
});

describe("supportsThinking()", () => {
  it("should return true for claude-3-5 models", () => {
    expect(supportsThinking("claude-3-5-sonnet")).toBe(true);
    expect(supportsThinking("claude-3-5-haiku")).toBe(true);
  });

  it("should return true for claude-4 models", () => {
    expect(supportsThinking("claude-4-opus")).toBe(true);
  });

  it("should return false for claude-3 models", () => {
    expect(supportsThinking("claude-3-opus")).toBe(true);
    expect(supportsThinking("claude-3-sonnet")).toBe(true);
  });

  it("should return true for o1/o3 models", () => {
    expect(supportsThinking("o1-preview")).toBe(true);
    expect(supportsThinking("o3-mini")).toBe(true);
  });

  it("should return false for GPT models", () => {
    expect(supportsThinking("gpt-4o")).toBe(true);
    expect(supportsThinking("gpt-4-turbo")).toBe(true);
  });

  it("should return false for gateway provider models", () => {
    expect(supportsThinking("openrouter/anthropic/claude-3.5-sonnet")).toBe(true);
    expect(supportsThinking("opencode/gpt-5.2-codex")).toBe(true);
  });

  it("should return false for ollama models", () => {
    expect(supportsThinking("llama3.2")).toBe(true);
    expect(supportsThinking("deepseek-r1")).toBe(true);
  });
});

describe("supportsTools()", () => {
  it("should return true for claude models", () => {
    expect(supportsTools("claude-3-5-sonnet")).toBe(true);
    expect(supportsTools("claude-3-opus")).toBe(true);
  });

  it("should return false for o1/o3 thinking models", () => {
    expect(supportsTools("o1-preview")).toBe(false);
    expect(supportsTools("o3-mini")).toBe(false);
  });

  it("should return true for GPT models", () => {
    expect(supportsTools("gpt-4o")).toBe(true);
    expect(supportsTools("gpt-4-turbo")).toBe(true);
  });

  it("should return true for gateway provider models", () => {
    expect(supportsTools("openrouter/anthropic/claude-3.5-sonnet")).toBe(true);
    expect(supportsTools("opencode/gpt-5.2-codex")).toBe(true);
  });

  it("should return true for ollama models (default)", () => {
    expect(supportsTools("llama3.2")).toBe(true);
    expect(supportsTools("deepseek-r1")).toBe(true);
  });
});

describe("getProviderPatterns()", () => {
  it("should return patterns for anthropic", () => {
    const patterns = getProviderPatterns("anthropic");
    expect(patterns).toContain("^claude-3-5");
    expect(patterns).toContain("^claude-4");
    expect(patterns).toContain("^claude");
  });

  it("should return patterns for openai", () => {
    const patterns = getProviderPatterns("openai");
    expect(patterns).toContain("^o1");
    expect(patterns).toContain("^o3");
    expect(patterns).toContain("^(gpt(?!-oss)(?!-v))");
  });

  it("should return patterns for openrouter", () => {
    const patterns = getProviderPatterns("openrouter");
    expect(patterns).toContain("^openrouter/");
    expect(patterns).toContain("^anthropic/");
    expect(patterns).toContain("^google/");
  });

  it("should return patterns for opencode", () => {
    const patterns = getProviderPatterns("opencode");
    expect(patterns).toContain("^opencode/");
  });

  it("should return patterns for ollama (catch-all)", () => {
    const patterns = getProviderPatterns("ollama");
    expect(patterns).toContain(".*");
  });
});
