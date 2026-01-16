import { Ollama } from "ollama";
import type {
  LLMClient,
  ChatOptions,
  ChatResponse,
  StreamChunk,
  Message,
  ToolDefinition,
  ToolCall,
} from "./types.js";
import type { ModelCapabilities } from "./capabilities.js";

export interface OllamaProviderConfig {
  baseUrl?: string;
  apiKey?: string;
}

type OllamaMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_name?: string;
};

type OllamaTool = {
  type: string;
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type OllamaToolCall = {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
};

function convertTools(tools: ToolDefinition[]): OllamaTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function parseToolCalls(toolCalls?: OllamaToolCall[]): ToolCall[] | undefined {
  if (!toolCalls?.length) return undefined;
  return toolCalls.map((tc) => ({
    id: crypto.randomUUID(),
    name: tc.function.name,
    arguments: tc.function.arguments,
  }));
}

function convertMessages(messages: Message[]): OllamaMessage[] {
  return messages.map((msg) => {
    if (msg.role === "tool") {
      return {
        role: "tool",
        content: msg.content,
        tool_name: msg.toolCallId,
      };
    }
    return {
      role: msg.role as "system" | "user" | "assistant",
      content: msg.content,
    };
  });
}

function mapFinishReason(doneReason: string | undefined): ChatResponse["finishReason"] {
  switch (doneReason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    default:
      return "stop";
  }
}

export class OllamaProvider implements LLMClient {
  private _client: Ollama;
  private _baseUrl: string;
  private _apiKey?: string;

  constructor(config: OllamaProviderConfig = {}) {
    this._baseUrl = config.baseUrl ?? "http://localhost:11434";
    this._apiKey = config.apiKey;
    this._client = new Ollama({
      host: this._baseUrl,
      headers: config.apiKey
        ? {
            Authorization: `Bearer ${config.apiKey}`,
          }
        : undefined,
    });
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    const response = await this._client.chat({
      model: options.model,
      messages: convertMessages(options.messages),
      tools: options.tools?.length ? convertTools(options.tools) : undefined,
      options: {
        temperature: options.temperature,
        num_predict: options.maxTokens,
      },
    });

    return {
      content: response.message.content,
      toolCalls: parseToolCalls(response.message.tool_calls),
      finishReason: mapFinishReason(response.done_reason),
    };
  }

  async *stream(options: ChatOptions): AsyncGenerator<StreamChunk, void, unknown> {
    let stream: AsyncIterable<unknown>;
    try {
      stream = await this._client.chat({
        model: options.model,
        messages: convertMessages(options.messages),
        tools: options.tools?.length ? convertTools(options.tools) : undefined,
        options: {
          temperature: options.temperature,
          num_predict: options.maxTokens,
        },
        stream: true,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      throw new Error(`Ollama API error: ${errorMessage}`);
    }

    const toolCallsBuffer: Map<number, { name: string; arguments: string }> = new Map();

    try {
      for await (const chunk of stream) {
        if (chunk.message?.tool_calls) {
          for (const tc of chunk.message.tool_calls) {
            const existing = toolCallsBuffer.get(0) ?? { name: "", arguments: "" };
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments) {
              existing.arguments += JSON.stringify(tc.function.arguments);
            }
            toolCallsBuffer.set(0, existing);
          }
        }

        if (chunk.message?.content) {
          yield {
            content: chunk.message.content,
            done: false,
          };
        }

        if (chunk.done) {
          const toolCalls: ToolCall[] | undefined =
            toolCallsBuffer.size > 0
              ? Array.from(toolCallsBuffer.values()).map((tc) => ({
                  id: crypto.randomUUID(),
                  name: tc.name,
                  arguments: JSON.parse(tc.arguments || "{}"),
                }))
              : undefined;

          yield {
            toolCalls,
            done: true,
          };
          return;
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      throw new Error(`Ollama stream error: ${errorMessage}`);
    }

    yield { done: true };
  }

  async getCapabilities(model: string): Promise<ModelCapabilities> {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this._apiKey) {
        headers["Authorization"] = `Bearer ${this._apiKey}`;
      }

      const showResponse = await fetch(`${this._baseUrl}/api/show`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: model }),
      });

      if (showResponse.ok) {
        const modelInfo = (await showResponse.json()) as {
          details?: {
            supports_function_calling?: boolean;
            supports_thinking?: boolean;
            context_length?: number;
            num_ctx?: number;
          };
        };
        const details = modelInfo.details ?? {};

        return {
          modelName: model,
          supportsTools: details?.supports_function_calling ?? true,
          supportsStreaming: true,
          supportsSystemPrompt: true,
          supportsToolStreaming: false,
          supportsThinking: details?.supports_thinking ?? false,
          contextWindow: details?.context_length ?? 128000,
          maxOutputTokens: details?.num_ctx ?? 4096,
        };
      }
    } catch (err) {
      console.warn(`Failed to fetch model details for ${model}: ${err}`);
    }

    return {
      modelName: model,
      supportsTools: true,
      supportsStreaming: true,
      supportsSystemPrompt: true,
      supportsToolStreaming: false,
      supportsThinking: false,
      contextWindow: 128000,
      maxOutputTokens: 4096,
    };
  }
}
