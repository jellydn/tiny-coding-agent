import { Ollama } from "ollama";
import type { ModelCapabilities } from "./capabilities.js";
import type { ChatOptions, ChatResponse, LLMClient, Message, StreamChunk, ToolCall, ToolDefinition } from "./types.js";

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

export function toErrorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
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

function mapFinishReason(doneReason: string | undefined): ChatResponse["finishReason"] {
	if (doneReason === "length") return "length";
	return "stop";
}

export class OllamaProvider implements LLMClient {
	private _client: Ollama;
	private _baseUrl: string;
	private _apiKey?: string;

	constructor(config: OllamaProviderConfig = {}) {
		this._baseUrl = config.baseUrl ?? "http://localhost:11434";
		this._apiKey = config.apiKey;
		const headers: Record<string, string> = {};
		if (config.apiKey) {
			headers.Authorization = `Bearer ${config.apiKey}`;
		}
		this._client = new Ollama({
			host: this._baseUrl,
			headers: Object.keys(headers).length > 0 ? headers : undefined,
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
		const body = {
			model: options.model,
			messages: convertMessages(options.messages),
			tools: options.tools?.length ? convertTools(options.tools) : undefined,
			options: {
				temperature: options.temperature,
				num_predict: options.maxTokens,
			},
			stream: true,
		};

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (this._apiKey) {
			headers.Authorization = `Bearer ${this._apiKey}`;
		}

		let response: Response;
		try {
			response = await fetch(`${this._baseUrl}/api/chat`, {
				method: "POST",
				headers,
				body: JSON.stringify(body),
				signal: options.signal,
			});
		} catch (error) {
			if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
			throw error instanceof Error ? error : new Error(String(error));
		}

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`Ollama API error: ${response.status} ${text}`);
		}

		const reader = response.body?.getReader();
		if (!reader) {
			throw new Error("Ollama API error: No response body");
		}

		const decoder = new TextDecoder();
		const toolCallsBuffer: Map<number, { name: string; arguments: string }> = new Map();

		try {
			while (true) {
				if (options.signal?.aborted) {
					reader.cancel();
					throw new DOMException("Aborted", "AbortError");
				}

				const { done, value } = await reader.read();
				if (done) break;

				const text = decoder.decode(value, { stream: true });
				const lines = text.split("\n").filter((line) => line.trim());

				for (const line of lines) {
					let chunk: {
						message?: {
							tool_calls?: Array<{
								function?: { name?: string; arguments?: Record<string, unknown> };
							}>;
							content?: string;
						};
						done?: boolean;
					};

					try {
						chunk = JSON.parse(line);
					} catch {
						continue;
					}

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
			}
		} catch (error) {
			if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
			throw error instanceof Error ? error : new Error(String(error));
		}

		yield { done: true };
	}

	async getCapabilities(model: string): Promise<ModelCapabilities> {
		try {
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			};
			if (this._apiKey) {
				headers.Authorization = `Bearer ${this._apiKey}`;
			}

			const showResponse = await fetch(`${this._baseUrl}/api/show`, {
				method: "POST",
				headers,
				body: JSON.stringify({ name: model }),
			});

			if (!showResponse.ok) {
				console.warn(`Failed to fetch model details for ${model}: HTTP ${showResponse.status}`);
				return this._getDefaultCapabilities(model);
			}

			const { details = {} } = (await showResponse.json()) as {
				details?: {
					supports_function_calling?: boolean;
					supports_thinking?: boolean;
					context_length?: number;
					num_ctx?: number;
				};
			};

			return {
				modelName: model,
				supportsTools: details.supports_function_calling ?? true,
				supportsStreaming: true,
				supportsSystemPrompt: true,
				supportsToolStreaming: false,
				supportsThinking: details.supports_thinking ?? false,
				contextWindow: details.context_length ?? 128000,
				maxOutputTokens: details.num_ctx ?? 4096,
			};
		} catch (error) {
			console.warn(`Failed to fetch model details for ${model}: ${error}`);
			return this._getDefaultCapabilities(model);
		}
	}

	private _getDefaultCapabilities(model: string): ModelCapabilities {
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
