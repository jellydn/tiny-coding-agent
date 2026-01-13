import { Ollama } from "ollama";
import type { LLMClient, ChatOptions, ChatResponse, StreamChunk, Message } from "./types.js";

export interface OllamaProviderConfig {
  baseUrl?: string;
}

type OllamaMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function convertMessages(messages: Message[]): OllamaMessage[] {
  return messages
    .filter((msg) => msg.role !== "tool")
    .map((msg) => ({
      role: msg.role as "system" | "user" | "assistant",
      content: msg.content,
    }));
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

  constructor(config: OllamaProviderConfig = {}) {
    this._client = new Ollama({
      host: config.baseUrl ?? "http://localhost:11434",
    });
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    const response = await this._client.chat({
      model: options.model,
      messages: convertMessages(options.messages),
      options: {
        temperature: options.temperature,
        num_predict: options.maxTokens,
      },
    });

    return {
      content: response.message.content,
      finishReason: mapFinishReason(response.done_reason),
    };
  }

  async *stream(options: ChatOptions): AsyncGenerator<StreamChunk, void, unknown> {
    const stream = await this._client.chat({
      model: options.model,
      messages: convertMessages(options.messages),
      options: {
        temperature: options.temperature,
        num_predict: options.maxTokens,
      },
      stream: true,
    });

    for await (const chunk of stream) {
      if (chunk.done) {
        yield {
          done: true,
        };
        return;
      }

      yield {
        content: chunk.message.content,
        done: false,
      };
    }

    yield { done: true };
  }
}
