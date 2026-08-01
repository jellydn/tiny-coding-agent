/**
 * Anthropic message/tool conversion utilities — pure functions extracted from
 * anthropic.ts to reduce provider complexity and improve testability.
 *
 * Handles:
 * - Converting internal Message[] to Anthropic API format
 * - Converting ToolDefinition[] to Anthropic tool format
 * - Parsing Anthropic ContentBlock[] responses
 * - Mapping Anthropic stop reasons to internal format
 * - Extracting token usage from Anthropic responses
 * - Building thinking configuration
 */

import type Anthropic from "@anthropic-ai/sdk";
import { buildTokenUsage, num } from "./provider-utils.js";
import type { ChatResponse, Message, TokenUsage, ToolCall, ToolDefinition } from "./types.js";

// Re-export Anthropic types for use in this module
type AnthropicMessage = Anthropic.Messages.MessageParam;
type AnthropicTool = Anthropic.Messages.Tool;
type ContentBlock = Anthropic.Messages.ContentBlock;

/**
 * Convert internal Message[] to Anthropic API format.
 *
 * Anthropic requires:
 * - System messages extracted to a separate `system` parameter
 * - Tool results appended to the preceding user message
 * - Assistant messages with tool calls use content blocks
 */
export function convertMessages(messages: Message[]): { system?: string; messages: AnthropicMessage[] } {
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

/**
 * Convert internal ToolDefinition[] to Anthropic API format.
 */
export function convertTools(tools: ToolDefinition[]): AnthropicTool[] {
	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		input_schema: tool.parameters as Anthropic.Messages.Tool.InputSchema,
	}));
}

/**
 * Parse Anthropic ContentBlock[] response into text + tool calls.
 */
export function parseContentBlocks(content: ContentBlock[]): { text: string; toolCalls?: ToolCall[] } {
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

/**
 * Map Anthropic stop reason to internal ChatResponse finish reason.
 */
export function mapStopReason(reason: string | null): ChatResponse["finishReason"] {
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

/**
 * Extract normalized TokenUsage from Anthropic usage object.
 */
export function extractAnthropicUsage(raw: unknown): TokenUsage | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const u = raw as Record<string, unknown>;
	const input = num(u.input_tokens);
	const output = num(u.output_tokens);
	const cachedRead = num(u.cache_read_input_tokens) ?? 0;
	const cachedCreate = num(u.cache_creation_input_tokens) ?? 0;
	const cached = cachedRead + cachedCreate;
	return buildTokenUsage({ input, output, cached, reasoning: num(u.reasoning_tokens) });
}

/**
 * Build Anthropic thinking configuration.
 */
export function buildThinkingConfig(enabled: boolean, budgetTokens?: number) {
	return enabled
		? {
				type: "enabled" as const,
				budget_tokens: budgetTokens ?? 2000,
			}
		: undefined;
}
