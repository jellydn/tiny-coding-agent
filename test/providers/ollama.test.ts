import { describe, it, expect, mock } from "bun:test";
import { toErrorMessage, OllamaProvider } from "../../src/providers/ollama.js";
import type { ChatOptions } from "../../src/providers/types.js";

describe("toErrorMessage()", () => {
  it("should return error message for Error instances", () => {
    const err = new Error("test error message");
    expect(toErrorMessage(err)).toBe("test error message");
  });

  it("should return string for string input", () => {
    expect(toErrorMessage("simple error")).toBe("simple error");
  });

  it("should return string representation for numbers", () => {
    expect(toErrorMessage(404)).toBe("404");
  });

  it("should return string representation for objects", () => {
    const obj = { code: "ENOENT", message: "file not found" };
    expect(toErrorMessage(obj)).toBe("[object Object]");
  });

  it("should handle null", () => {
    expect(toErrorMessage(null)).toBe("null");
  });

  it("should handle undefined", () => {
    expect(toErrorMessage(undefined)).toBe("undefined");
  });
});

describe("OllamaProvider", () => {
  describe("constructor", () => {
    it("should use default base URL when not provided", () => {
      const provider = new OllamaProvider();
      expect(provider).toBeDefined();
    });

    it("should use custom base URL when provided", () => {
      const provider = new OllamaProvider({ baseUrl: "http://custom:11434" });
      expect(provider).toBeDefined();
    });

    it("should accept API key configuration", () => {
      const provider = new OllamaProvider({ apiKey: "test-key" });
      expect(provider).toBeDefined();
    });
  });

  describe("getCapabilities()", () => {
    it("should return default capabilities when API call fails", async () => {
      const provider = new OllamaProvider({ baseUrl: "http://invalid:9999" });

      const caps = await provider.getCapabilities("llama3");

      expect(caps.modelName).toBe("llama3");
      expect(caps.supportsTools).toBe(true);
      expect(caps.supportsStreaming).toBe(true);
      expect(caps.supportsSystemPrompt).toBe(true);
      expect(caps.supportsToolStreaming).toBe(false);
      expect(caps.supportsThinking).toBe(false);
      expect(caps.contextWindow).toBe(128000);
      expect(caps.maxOutputTokens).toBe(4096);
    });

    it("should include model name in capabilities", async () => {
      const provider = new OllamaProvider();
      const modelName = "mistral:latest";

      const caps = await provider.getCapabilities(modelName);

      expect(caps.modelName).toBe(modelName);
    });

    it("should reflect actual model capabilities when API responds", async () => {
      const originalFetch = globalThis.fetch;
      const mockFetch = mock(async () => {
        return new Response(
          JSON.stringify({
            details: {
              supports_function_calling: true,
              supports_thinking: true,
              context_length: 65536,
              num_ctx: 8192,
            },
          }),
          { status: 200 },
        );
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      try {
        const provider = new OllamaProvider();
        const caps = await provider.getCapabilities("deepseek-r1");

        expect(caps.supportsThinking).toBe(true);
        expect(caps.contextWindow).toBe(65536);
        expect(caps.maxOutputTokens).toBe(8192);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("chat()", () => {
    it("should throw network errors directly when server unreachable", async () => {
      const provider = new OllamaProvider({ baseUrl: "http://invalid:9999" });

      const options: ChatOptions = {
        model: "llama3",
        messages: [{ role: "user", content: "test" }],
      };

      expect(provider.chat(options)).rejects.toBeInstanceOf(Error);
    });

    it("should throw context length errors with helpful message", async () => {
      const originalFetch = globalThis.fetch;
      const mockFetch = mock(async () => {
        return new Response(JSON.stringify({ error: "prompt too long" }), { status: 400 });
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      try {
        const provider = new OllamaProvider();
        const options: ChatOptions = {
          model: "llama3",
          messages: [{ role: "user", content: "test" }],
        };

        expect(provider.chat(options)).rejects.toThrow(/prompt too long/);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("should return chat response with content on success", async () => {
      const originalFetch = globalThis.fetch;
      const mockFetch = mock(async () => {
        return new Response(
          JSON.stringify({
            message: { content: "Hello! How can I help you?" },
            done_reason: "stop",
          }),
          { status: 200 },
        );
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      try {
        const provider = new OllamaProvider();
        const options: ChatOptions = {
          model: "llama3",
          messages: [{ role: "user", content: "hello" }],
        };

        const response = await provider.chat(options);

        expect(response.content).toBe("Hello! How can I help you?");
        expect(response.finishReason).toBe("stop");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("stream()", () => {
    it("should handle abort signal during streaming", async () => {
      const provider = new OllamaProvider();
      const abortController = new AbortController();

      const options: ChatOptions = {
        model: "llama3",
        messages: [{ role: "user", content: "test" }],
        signal: abortController.signal,
      };

      const generator = provider.stream(options);

      const promise = generator.next();

      abortController.abort();

      try {
        await promise;
      } catch (err) {
        expect(err instanceof Error).toBe(true);
      }
    });

    it("should throw Ollama API error for non-OK responses", async () => {
      const provider = new OllamaProvider({ baseUrl: "http://invalid:9999" });

      const options: ChatOptions = {
        model: "llama3",
        messages: [{ role: "user", content: "test" }],
      };

      const generator = provider.stream(options);

      expect(generator.next()).rejects.toBeInstanceOf(Error);
    });

    it("should yield content chunks during streaming", async () => {
      const originalFetch = globalThis.fetch;
      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              JSON.stringify({ message: { content: "Hello" }, done: false }) + "\n",
            ),
          );
          controller.enqueue(
            new TextEncoder().encode(
              JSON.stringify({ message: { content: " World" }, done: false }) + "\n",
            ),
          );
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ done: true }) + "\n"));
          controller.close();
        },
      });

      const mockFetch = mock(async () => {
        return new Response(stream, { status: 200 });
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      try {
        const provider = new OllamaProvider();
        const options: ChatOptions = {
          model: "llama3",
          messages: [{ role: "user", content: "test" }],
        };

        const chunks: string[] = [];
        for await (const chunk of provider.stream(options)) {
          if (chunk.content) chunks.push(chunk.content);
        }

        expect(chunks).toEqual(["Hello", " World"]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
