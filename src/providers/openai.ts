import OpenAI from "openai";
import type { ModelCapabilities } from "./capabilities.js";
import { supportsThinking as modelRegistrySupportsThinking } from "./model-registry.js";
import { getModelCapabilitiesFromCatalog } from "./models-dev.js";
import { buildRequestBody, mapFinishReason, parseStreamedToolCalls, parseToolCalls } from "./openai-protocol.js";
import type { ChatOptions, ChatResponse, LLMClient, StreamChunk, ToolCall } from "./types.js";

export interface OpenAIProviderConfig {
	apiKey: string;
	baseUrl?: string;
}

export class OpenAIProvider implements LLMClient {
	private _client: OpenAI;
	private _capabilitiesCache = new Map<string, ModelCapabilities>();

	constructor(config: OpenAIProviderConfig) {
		this._client = new OpenAI({
			apiKey: config.apiKey,
			baseURL: config.baseUrl,
		});
	}

	async chat(options: ChatOptions): Promise<ChatResponse> {
		const requestBody = buildRequestBody(options, false);
		const response = await this._client.chat.completions.create(
			requestBody as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
			{ signal: options.signal }
		);

		const choice = response.choices[0];
		const message = choice?.message;

		return {
			content: message?.content ?? "",
			toolCalls: parseToolCalls(message?.tool_calls),
			finishReason: mapFinishReason(choice?.finish_reason ?? null),
		};
	}

	async *stream(options: ChatOptions): AsyncGenerator<StreamChunk, void, unknown> {
		const requestBody = buildRequestBody(options, true);
		const stream = await this._client.chat.completions.create(
			requestBody as unknown as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
			{ signal: options.signal }
		);

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
				const toolCalls: ToolCall[] | undefined = parseStreamedToolCalls(toolCallsBuffer);
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
		const cached = this._capabilitiesCache.get(model);
		if (cached) return cached;

		const modelContextWindow: Record<string, number> = {
			"gpt-4o": 128000,
			"gpt-4o-mini": 128000,
			"gpt-4-turbo": 128000,
			"gpt-4": 8192,
			"gpt-3.5-turbo": 16385,
			o1: 200000,
			"o1-mini": 128000,
			"o1-preview": 128000,
			"o3-mini": 200000,
		};

		const hasThinking = modelRegistrySupportsThinking(model);

		if (model in modelContextWindow) {
			const capabilities: ModelCapabilities = {
				modelName: model,
				supportsTools: true,
				supportsStreaming: true,
				supportsSystemPrompt: true,
				supportsToolStreaming: !hasThinking,
				supportsThinking: hasThinking,
				contextWindow: modelContextWindow[model],
				maxOutputTokens: hasThinking ? 100000 : 4096,
				isVerified: false,
				source: "fallback",
			};

			this._capabilitiesCache.set(model, capabilities);
			return capabilities;
		}

		const catalogCapabilities = getModelCapabilitiesFromCatalog(model, "openai");
		if (catalogCapabilities) {
			this._capabilitiesCache.set(model, catalogCapabilities);
			return catalogCapabilities;
		}

		const capabilities: ModelCapabilities = {
			modelName: model,
			supportsTools: true,
			supportsStreaming: true,
			supportsSystemPrompt: true,
			supportsToolStreaming: true,
			supportsThinking: false,
			contextWindow: 16385,
			maxOutputTokens: 4096,
			isVerified: false,
			source: "fallback",
		};

		this._capabilitiesCache.set(model, capabilities);
		return capabilities;
	}
}
