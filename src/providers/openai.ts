import OpenAI from "openai";
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

export interface OpenAIProviderConfig {
  apiKey: string;
  baseUrl?: string;
}

type OpenAIMessage = OpenAI.Chat.ChatCompletionMessageParam;
type OpenAITool = OpenAI.Chat.ChatCompletionTool;

function convertMessages(messages: Message[]): OpenAIMessage[] {
  return messages.map((msg): OpenAIMessage => {
    if (msg.role === "tool") {
      return {
        role: "tool",
        content: msg.content,
        tool_call_id: msg.toolCallId ?? "",
      };
    }

    if (msg.role === "assistant" && msg.toolCalls?.length) {
      return {
        role: "assistant",
        content: msg.content || null,
        tool_calls: msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        })),
      };
    }

    return {
      role: msg.role as "system" | "user" | "assistant",
      content: msg.content,
    };
  });
}

function convertTools(tools: ToolDefinition[]): OpenAITool[] {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function parseToolCalls(
  toolCalls?: OpenAI.Chat.ChatCompletionMessageToolCall[],
): ToolCall[] | undefined {
  if (!toolCalls?.length) return undefined;

  return toolCalls
    .filter(
      (tc): tc is OpenAI.Chat.ChatCompletionMessageToolCall & { type: "function" } =>
        tc.type === "function",
    )
    .map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments || "{}"),
    }));
}

function mapFinishReason(reason: string | null): ChatResponse["finishReason"] {
  switch (reason) {
    case "stop":
      return "stop";
    case "tool_calls":
      return "tool_calls";
    case "length":
      return "length";
    default:
      return "stop";
  }
}

export class OpenAIProvider implements LLMClient {
  private _client: OpenAI;

  constructor(config: OpenAIProviderConfig) {
    this._client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    const response = await this._client.chat.completions.create({
      model: options.model,
      messages: convertMessages(options.messages),
      tools: options.tools?.length ? convertTools(options.tools) : undefined,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      // @ts-ignore - reasoning_effort is supported for o1/o3 models
      reasoning_effort: options.thinking?.effort,
    });

    const choice = response.choices[0];
    const message = choice?.message;

    return {
      content: message?.content ?? "",
      toolCalls: parseToolCalls(message?.tool_calls),
      finishReason: mapFinishReason(choice?.finish_reason ?? null),
    };
  }

  async *stream(options: ChatOptions): AsyncGenerator<StreamChunk, void, unknown> {
    const stream = await this._client.chat.completions.create({
      model: options.model,
      messages: convertMessages(options.messages),
      tools: options.tools?.length ? convertTools(options.tools) : undefined,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      stream: true,
      // @ts-ignore - reasoning_effort is supported for o1/o3 models
      reasoning_effort: options.thinking?.effort,
    });

    const toolCallsBuffer: Map<number, { id: string; name: string; args: string }> = new Map();

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      const finishReason = chunk.choices[0]?.finish_reason;

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = toolCallsBuffer.get(tc.index) ?? { id: "", name: "", args: "" };
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.name = tc.function.name;
          if (tc.function?.arguments) existing.args += tc.function.arguments;
          toolCallsBuffer.set(tc.index, existing);
        }
      }

      if (delta?.content) {
        yield {
          content: delta.content,
          done: false,
        };
      }

      if (finishReason) {
        const toolCalls: ToolCall[] | undefined =
          toolCallsBuffer.size > 0
            ? Array.from(toolCallsBuffer.values()).map((tc) => ({
                id: tc.id,
                name: tc.name,
                arguments: JSON.parse(tc.args || "{}"),
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
  }

  async getCapabilities(model: string): Promise<ModelCapabilities> {
    const modelContextWindow: Record<string, number> = {
      "gpt-4o": 128000,
      "gpt-4o-mini": 128000,
      "gpt-4-turbo": 128000,
      "gpt-4": 8192,
      "gpt-3.5-turbo": 16385,
      // Thinking models
      o1: 200000,
      "o1-mini": 128000,
      "o1-preview": 128000,
      "o3-mini": 200000,
    };

    // Detect thinking models (o1, o3 series)
    const isThinkingModel = /^o[13]/.test(model);

    return {
      modelName: model,
      supportsTools: !isThinkingModel, // o1/o3 don't support tools yet
      supportsStreaming: true,
      supportsSystemPrompt: !isThinkingModel, // o1/o3 don't use system prompts
      supportsToolStreaming: !isThinkingModel,
      supportsThinking: isThinkingModel,
      contextWindow: modelContextWindow[model] ?? 16385,
      maxOutputTokens: isThinkingModel ? 100000 : 4096,
    };
  }
}
