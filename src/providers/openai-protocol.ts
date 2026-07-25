import type OpenAI from "openai";
import type { ChatOptions, ChatResponse, Message, ToolCall, ToolDefinition } from "./types.js";

export type OpenAIMessage = OpenAI.Chat.ChatCompletionMessageParam;
export type OpenAITool = OpenAI.Chat.ChatCompletionTool;

export function convertMessages(messages: Message[]): OpenAIMessage[] {
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

export function convertTools(tools: ToolDefinition[]): OpenAITool[] {
	return tools.map((tool) => ({
		type: "function" as const,
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
		},
	}));
}

export function parseToolCalls(toolCalls?: OpenAI.Chat.ChatCompletionMessageToolCall[]): ToolCall[] | undefined {
	if (!toolCalls?.length) return undefined;

	return toolCalls
		.filter((tc): tc is OpenAI.Chat.ChatCompletionMessageToolCall & { type: "function" } => tc.type === "function")
		.map((tc) => {
			try {
				return {
					id: tc.id,
					name: tc.function.name,
					arguments: JSON.parse(tc.function.arguments || "{}"),
				};
			} catch (err) {
				console.warn(`[OpenAIProtocol] Failed to parse tool arguments for ${tc.function.name}: ${err}`);
				return {
					id: tc.id,
					name: tc.function.name,
					arguments: {},
				};
			}
		});
}

export function mapFinishReason(reason: string | null): ChatResponse["finishReason"] {
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

export function parseStreamedToolCalls(
	toolCallsBuffer: Map<number, { id: string; name: string; args: string }>
): ToolCall[] | undefined {
	if (toolCallsBuffer.size === 0) return undefined;
	return Array.from(toolCallsBuffer.values()).map((tc) => {
		try {
			return {
				id: tc.id,
				name: tc.name,
				arguments: JSON.parse(tc.args || "{}"),
			};
		} catch (err) {
			console.warn(`[OpenAIProtocol] Failed to parse streamed tool arguments for ${tc.name}: ${err}`);
			return {
				id: tc.id,
				name: tc.name,
				arguments: {},
			};
		}
	});
}

export function buildRequestBody(options: ChatOptions, stream: boolean): Record<string, unknown> {
	const body: Record<string, unknown> = {
		model: options.model,
		messages: convertMessages(options.messages),
		tools: options.tools?.length ? convertTools(options.tools) : undefined,
		temperature: options.temperature,
		max_tokens: options.maxTokens,
		reasoning_effort: options.thinking?.effort,
	};
	if (stream) body.stream = true;
	return body;
}
