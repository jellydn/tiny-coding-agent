import Anthropic from "@anthropic-ai/sdk";
import {
	buildThinkingConfig,
	convertMessages,
	convertTools,
	extractAnthropicUsage,
	mapStopReason,
	parseContentBlocks,
} from "./anthropic-converters.js";
import type { ModelCapabilities } from "./capabilities.js";
import { supportsThinking as modelRegistrySupportsThinking } from "./model-registry.js";
import { capabilitiesWithCatalogFallback, num } from "./provider-utils.js";
import type { ChatOptions, ChatResponse, LLMClient, StreamChunk, TokenUsage, ToolCall } from "./types.js";

export interface AnthropicProviderConfig {
	apiKey: string;
}

type ContentBlockDelta = Anthropic.Messages.ContentBlockDeltaEvent;

// Re-export for backward compatibility
export { buildThinkingConfig, convertMessages, convertTools } from "./anthropic-converters.js";

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

		const thinking = buildThinkingConfig(options.thinking?.enabled ?? false, options.thinking?.budgetTokens);

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
			{ signal: options.signal }
		);

		const { text, toolCalls } = parseContentBlocks(response.content);

		return {
			content: text,
			toolCalls,
			finishReason: mapStopReason(response.stop_reason),
			usage: extractAnthropicUsage(response.usage),
		};
	}

	async *stream(options: ChatOptions): AsyncGenerator<StreamChunk, void, unknown> {
		const { system, messages } = convertMessages(options.messages);

		const thinking = buildThinkingConfig(options.thinking?.enabled ?? false, options.thinking?.budgetTokens);

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
			let streamUsage: TokenUsage | undefined;
			let streamOutputTokens: number | undefined;

			for await (const event of stream) {
				// Backpressure check: pause if we've yielded too many chunks
				if (chunkCount >= maxChunks) {
					yield {
						content: "",
						usage: streamUsage ? { ...streamUsage, outputTokens: streamOutputTokens } : undefined,
						done: false,
					};
					return;
				}

				if (event.type === "message_start") {
					const startUsage = (event as unknown as { message?: { usage?: Record<string, unknown> } }).message?.usage;
					if (startUsage) {
						const base = extractAnthropicUsage(startUsage);
						if (base) streamUsage = base;
					}
				} else if (event.type === "content_block_start") {
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
				} else if (event.type === "message_delta") {
					const deltaUsage = (event as unknown as { usage?: Record<string, unknown> }).usage;
					if (deltaUsage) {
						const out = num(deltaUsage.output_tokens);
						if (out !== undefined) streamOutputTokens = out;
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

					const finalUsage = streamUsage
						? { ...streamUsage, outputTokens: streamOutputTokens ?? streamUsage.outputTokens }
						: undefined;
					yield {
						toolCalls,
						usage: finalUsage,
						done: true,
					};
					return;
				}
			}

			yield { done: true, usage: streamUsage ? { ...streamUsage, outputTokens: streamOutputTokens } : undefined };
		} finally {
			options.signal?.removeEventListener("abort", abortHandler);
		}
	}

	async getCapabilities(model: string): Promise<ModelCapabilities> {
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

		if (contextWindow !== undefined) {
			const capabilities: ModelCapabilities = {
				modelName: model,
				supportsTools: true,
				supportsStreaming: true,
				supportsSystemPrompt: true,
				supportsToolStreaming: true,
				supportsThinking: hasThinking,
				contextWindow,
				maxOutputTokens: 8192,
				isVerified: false,
				source: "fallback",
			};

			this._capabilitiesCache.set(model, capabilities);
			return capabilities;
		}

		const catalogCaps = capabilitiesWithCatalogFallback({
			model,
			providerType: "anthropic",
			contextWindow: 200000,
			maxOutputTokens: 8192,
		});

		if (catalogCaps.source === "catalog") {
			this._capabilitiesCache.set(model, catalogCaps);
			return catalogCaps;
		}

		console.warn(
			`[WARN] Unknown model "${model}" - using default context window of 200000 tokens. ` +
				"Context limits may be inaccurate. Consider updating the model registry."
		);

		const hasThinkingOverride = modelRegistrySupportsThinking(model);
		const fallback: ModelCapabilities = {
			...catalogCaps,
			supportsThinking: hasThinkingOverride,
		};

		this._capabilitiesCache.set(model, fallback);
		return fallback;
	}
}
