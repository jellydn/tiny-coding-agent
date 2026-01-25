import Anthropic from "@anthropic-ai/sdk";
import type {
  LLMClient,
  ChatOptions,
  ChatResponse,
  StreamChunk,
  ToolCall,
  Message,
  ToolDefinition,
} from "./types.js";
import type { ModelCapabilities } from "./capabilities.js";
import { supportsThinking as modelRegistrySupportsThinking } from "./model-registry.js";

export interface AnthropicProviderConfig {
  apiKey: string;
}

type AnthropicMessage = Anthropic.Messages.MessageParam;
type AnthropicTool = Anthropic.Messages.Tool;
type ContentBlock = Anthropic.Messages.ContentBlock;
type ContentBlockDelta = Anthropic.Messages.ContentBlockDeltaEvent;

function convertMessages(messages: Message[]): { system?: string; messages: AnthropicMessage[] } {
  const systemMessages: string[] = [];
  const converted: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemMessages.push(msg.content);
      continue;
    }

    if (msg.role === "user") {
      converted.push({
        role: "user",
        content: msg.content,
      });
    } else if (msg.role === "assistant") {
      if (msg.toolCalls?.length) {
        const content: Anthropic.Messages.ContentBlockParam[] = [];
        if (msg.content) {
          content.push({ type: "text", text: msg.content });
        }
        for (const tc of msg.toolCalls) {
          content.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          });
        }
        converted.push({ role: "assistant", content });
      } else {
        converted.push({
          role: "assistant",
          content: msg.content,
        });
      }
    } else if (msg.role === "tool") {
      const lastMsg = converted[converted.length - 1];
      if (lastMsg?.role === "user" && Array.isArray(lastMsg.content)) {
        lastMsg.content.push({
          type: "tool_result",
          tool_use_id: msg.toolCallId ?? "",
          content: msg.content,
        });
      } else {
        converted.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: msg.toolCallId ?? "",
              content: msg.content,
            },
          ],
        });
      }
    }
  }

  const combinedSystem = systemMessages.length > 0 ? systemMessages.join("\n\n---\n\n") : undefined;
  return { system: combinedSystem, messages: converted };
}

function convertTools(tools: ToolDefinition[]): AnthropicTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as Anthropic.Messages.Tool.InputSchema,
  }));
}

function parseContentBlocks(content: ContentBlock[]): { text: string; toolCalls?: ToolCall[] } {
  let text = "";
  const toolCalls: ToolCall[] = [];

  for (const block of content) {
    if (block.type === "text") {
      text += block.text;
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: block.input as Record<string, unknown>,
      });
    }
  }

  return {
    text,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

function mapStopReason(reason: string | null): ChatResponse["finishReason"] {
  switch (reason) {
    case "end_turn":
      return "stop";
    case "tool_use":
      return "tool_calls";
    case "max_tokens":
      return "length";
    default:
      return "stop";
  }
}

export function buildThinkingConfig(enabled: boolean, budgetTokens?: number) {
  return enabled
    ? {
        type: "enabled" as const,
        budget_tokens: budgetTokens ?? 2000,
      }
    : undefined;
}

export class AnthropicProvider implements LLMClient {
  private _client: Anthropic;
  private _capabilitiesCache = new Map<string, ModelCapabilities>();

  constructor(config: AnthropicProviderConfig) {
    this._client = new Anthropic({
      apiKey: config.apiKey,
    });
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    const { system, messages } = convertMessages(options.messages);

    const thinking = buildThinkingConfig(
      options.thinking?.enabled ?? false,
      options.thinking?.budgetTokens,
    );

    const response = await this._client.messages.create(
      {
        model: options.model,
        max_tokens: options.maxTokens ?? 4096,
        system,
        messages,
        tools: options.tools?.length ? convertTools(options.tools) : undefined,
        temperature: options.temperature,
        thinking,
      },
      { signal: options.signal },
    );

    const { text, toolCalls } = parseContentBlocks(response.content);

    return {
      content: text,
      toolCalls,
      finishReason: mapStopReason(response.stop_reason),
    };
  }

  async *stream(options: ChatOptions): AsyncGenerator<StreamChunk, void, unknown> {
    const { system, messages } = convertMessages(options.messages);

    const thinking = buildThinkingConfig(
      options.thinking?.enabled ?? false,
      options.thinking?.budgetTokens,
    );

    const stream = this._client.messages.stream({
      model: options.model,
      max_tokens: options.maxTokens ?? 4096,
      system,
      messages,
      tools: options.tools?.length ? convertTools(options.tools) : undefined,
      temperature: options.temperature,
      thinking,
    });

    const abortHandler = () => {
      stream.controller.abort();
    };
    options.signal?.addEventListener("abort", abortHandler);

    // Backpressure safety: limit chunks to prevent memory exhaustion
    const maxChunks = options.maxChunks ?? 10000;
    let chunkCount = 0;

    try {
      const toolCallsBuffer: Map<number, { id: string; name: string; input: string }> = new Map();
      let currentBlockIndex = -1;

      for await (const event of stream) {
        // Backpressure check: pause if we've yielded too many chunks
        if (chunkCount >= maxChunks) {
          yield {
            content: "",
            done: false,
          };
          return;
        }

        if (event.type === "content_block_start") {
          currentBlockIndex = event.index;
          if (event.content_block.type === "tool_use") {
            toolCallsBuffer.set(currentBlockIndex, {
              id: event.content_block.id,
              name: event.content_block.name,
              input: "",
            });
          }
        } else if (event.type === "content_block_delta") {
          const delta = event as ContentBlockDelta;
          if (delta.delta.type === "text_delta") {
            chunkCount++;
            yield {
              content: delta.delta.text,
              done: false,
            };
          } else if (delta.delta.type === "input_json_delta") {
            const existing = toolCallsBuffer.get(delta.index);
            if (existing) {
              existing.input += delta.delta.partial_json;
            }
          }
        } else if (event.type === "message_stop") {
          chunkCount++;
          const toolCalls: ToolCall[] | undefined =
            toolCallsBuffer.size > 0
              ? Array.from(toolCallsBuffer.values()).map((tc) => ({
                  id: tc.id,
                  name: tc.name,
                  arguments: JSON.parse(tc.input || "{}"),
                }))
              : undefined;

          yield {
            toolCalls,
            done: true,
          };
          return;
        }
      }

      yield { done: true };
    } finally {
      options.signal?.removeEventListener("abort", abortHandler);
    }
  }

  async getCapabilities(model: string): Promise<ModelCapabilities> {
    // Guard: check cache first
    const cached = this._capabilitiesCache.get(model);
    if (cached) return cached;

    const modelContextWindow: Record<string, number> = {
      "claude-3-5-sonnet-20241022": 200000,
      "claude-3-5-haiku-20241022": 200000,
      "claude-3-opus-20240229": 200000,
      "claude-3-sonnet-20240229": 200000,
      "claude-3-haiku-20240307": 200000,
      "claude-sonnet-4-20250520": 200000,
      "claude-opus-4-20250520": 200000,
      "claude-haiku-4-20250520": 200000,
    };

    const hasThinking = modelRegistrySupportsThinking(model);
    const contextWindow = modelContextWindow[model];

    // Warn for unknown models with hardcoded fallback
    if (!contextWindow) {
      console.warn(
        `[WARN] Unknown model "${model}" - using default context window of 200000 tokens. ` +
          "Context limits may be inaccurate. Consider updating the model registry.",
      );
    }

    const capabilities: ModelCapabilities = {
      modelName: model,
      supportsTools: true,
      supportsStreaming: true,
      supportsSystemPrompt: true,
      supportsToolStreaming: true,
      supportsThinking: hasThinking,
      contextWindow: contextWindow ?? 200000,
      maxOutputTokens: 8192,
    };

    this._capabilitiesCache.set(model, capabilities);
    return capabilities;
  }
}
