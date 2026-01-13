export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface Message {
  role: MessageRole;
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatOptions {
  model: string;
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResponse {
  content: string;
  toolCalls?: ToolCall[];
  finishReason: "stop" | "tool_calls" | "length" | "error";
}

export interface StreamChunk {
  content?: string;
  toolCalls?: ToolCall[];
  done: boolean;
}

import type { ModelCapabilities } from "./capabilities.js";

export interface LLMClient {
  chat(options: ChatOptions): Promise<ChatResponse>;
  stream(options: ChatOptions): AsyncGenerator<StreamChunk, void, unknown>;
  getCapabilities(model: string): Promise<ModelCapabilities>;
}
