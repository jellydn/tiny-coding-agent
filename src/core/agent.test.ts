import { describe, it, expect, beforeEach } from "bun:test";
import { unlinkSync, writeFileSync } from "node:fs";
import type {
  LLMClient,
  Message,
  ChatOptions,
  StreamChunk,
  ChatResponse,
} from "../providers/types.js";
import { ToolRegistry } from "../tools/registry.js";
import { Agent } from "./agent.js";

const tempConversationFile = "/tmp/test-agent-conversation.json";

beforeEach(() => {
  try {
    unlinkSync(tempConversationFile);
  } catch {
    // Ignore if file doesn't exist
  }
});

class MockLLMClient implements LLMClient {
  async chat(_options: ChatOptions): Promise<ChatResponse> {
    return {
      content: "Mock response",
      finishReason: "stop",
    };
  }

  async *stream(_options: ChatOptions): AsyncGenerator<StreamChunk, void, unknown> {
    yield { content: "Mock response", done: false };
    yield { done: true };
  }

  async getCapabilities(_model: string) {
    return {
      maxTokens: 100000,
      supportsStreaming: true,
      supportsTools: true,
      modelName: "mock-model",
      supportsSystemPrompt: true,
      supportsToolStreaming: false,
      supportsThinking: false,
    };
  }
}

function createMessages(...contents: string[]): Message[] {
  return contents.map((content, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content,
  }));
}

describe("Agent", () => {
  describe("startChatSession()", () => {
    it("should reset conversation history to empty array", async () => {
      const llm = new MockLLMClient();
      const registry = new ToolRegistry();
      const agent = new Agent(llm, registry);

      for await (const _chunk of agent.runStream("test", "mock-model")) {
      }

      agent.startChatSession();

      expect(
        (agent as unknown as { _conversationHistory: Message[] })._conversationHistory,
      ).toEqual([]);
    });
  });

  describe("runStream() - conversation history without file", () => {
    it("should use in-memory history when no conversation file is set", async () => {
      const llm = new MockLLMClient();
      const registry = new ToolRegistry();
      const agent = new Agent(llm, registry);

      const chunks: string[] = [];
      for await (const chunk of agent.runStream("First message", "mock-model")) {
        if (chunk.content) chunks.push(chunk.content);
      }

      const history = (agent as unknown as { _conversationHistory: Message[] })
        ._conversationHistory;
      expect(history.length).toBeGreaterThanOrEqual(2);
      expect(history[0]).toEqual({
        role: "user",
        content: "First message",
      });
    });

    it("should maintain conversation history across multiple turns", async () => {
      const llm = new MockLLMClient();
      const registry = new ToolRegistry();
      const agent = new Agent(llm, registry);

      for await (const _chunk of agent.runStream("Hello", "mock-model")) {
      }

      const historyAfterFirst = (agent as unknown as { _conversationHistory: Message[] })
        ._conversationHistory.length;
      expect(historyAfterFirst).toBeGreaterThan(0);

      for await (const _chunk of agent.runStream("What's my name?", "mock-model")) {
      }

      const history = (agent as unknown as { _conversationHistory: Message[] })
        ._conversationHistory;
      expect(history.length).toBeGreaterThan(historyAfterFirst);
      expect(history[0]).toEqual({
        role: "user",
        content: "Hello",
      });
    });

    it("should start fresh when startChatSession() is called", async () => {
      const llm = new MockLLMClient();
      const registry = new ToolRegistry();
      const agent = new Agent(llm, registry);

      for await (const _chunk of agent.runStream("First session", "mock-model")) {
      }

      expect(
        (agent as unknown as { _conversationHistory: Message[] })._conversationHistory.length,
      ).toBeGreaterThan(0);

      agent.startChatSession();
      expect(
        (agent as unknown as { _conversationHistory: Message[] })._conversationHistory,
      ).toEqual([]);

      for await (const _chunk of agent.runStream("Second session", "mock-model")) {
      }

      const history = (agent as unknown as { _conversationHistory: Message[] })
        ._conversationHistory;
      expect(history[0]).toEqual({
        role: "user",
        content: "Second session",
      });
    });
  });

  describe("runStream() - with conversation file", () => {
    it("should load conversation from file when conversationFile is set", async () => {
      const existingConversation = createMessages(
        "Previous user message",
        "Previous assistant response",
      );

      writeFileSync(
        tempConversationFile,
        JSON.stringify({ messages: existingConversation }, null, 2),
      );

      const llm = new MockLLMClient();
      const registry = new ToolRegistry();
      const agent = new Agent(llm, registry, {
        conversationFile: tempConversationFile,
      });

      for await (const _chunk of agent.runStream("New message", "mock-model")) {
      }

      const history = (agent as unknown as { _conversationHistory: Message[] })
        ._conversationHistory;
      expect(history[0]).toEqual({
        role: "user",
        content: "Previous user message",
      });
      expect(history[1]).toEqual({
        role: "assistant",
        content: "Previous assistant response",
      });
      expect(history[2]).toEqual({
        role: "user",
        content: "New message",
      });
    });
  });

  describe("_updateConversationHistory()", () => {
    it("should update in-memory history when called", () => {
      const llm = new MockLLMClient();
      const registry = new ToolRegistry();
      const agent = new Agent(llm, registry);

      const messages = createMessages("User message", "Assistant response");

      agent._updateConversationHistory(messages);

      expect(
        (agent as unknown as { _conversationHistory: Message[] })._conversationHistory,
      ).toEqual(messages);
    });
  });

  describe("Tool not found error handling", () => {
    it("should stop loop when tool is not found", async () => {
      // Mock LLM that tries to call a non-existent tool
      class ToolCallMockLLMClient implements LLMClient {
        private callCount = 0;

        async chat(_options: ChatOptions): Promise<ChatResponse> {
          return {
            content: "Mock response",
            finishReason: "stop",
          };
        }

        async *stream(_options: ChatOptions): AsyncGenerator<StreamChunk, void, unknown> {
          this.callCount++;

          if (this.callCount === 1) {
            // First call: try to use a non-existent tool
            yield {
              content: "",
              toolCalls: [
                {
                  id: "call_123",
                  name: "nonexistent.tool",
                  arguments: { param: "value" },
                },
              ],
              done: false,
            };
            yield { done: true };
          } else {
            // Second call: provide final answer after error
            yield { content: "I couldn't find that tool. Here's my answer anyway.", done: false };
            yield { done: true };
          }
        }

        async getCapabilities(_model: string) {
          return {
            maxTokens: 100000,
            supportsStreaming: true,
            supportsTools: true,
            modelName: "mock-model",
            supportsSystemPrompt: true,
            supportsToolStreaming: false,
            supportsThinking: false,
          };
        }
      }

      const llm = new ToolCallMockLLMClient();
      const registry = new ToolRegistry();
      const agent = new Agent(llm, registry);

      const chunks: unknown[] = [];
      for await (const chunk of agent.runStream("Use a tool", "mock-model")) {
        chunks.push(chunk);
      }

      const lastChunk = chunks[chunks.length - 1] as { iterations: number };
      expect(lastChunk.iterations).toBe(1);

      const history = (agent as unknown as { _conversationHistory: Message[] })
        ._conversationHistory;
      const hasSystemError = history.some(
        (msg: Message) => msg.role === "system" && msg.content.includes("not available"),
      );
      expect(hasSystemError).toBe(true);
    });
  });
});
