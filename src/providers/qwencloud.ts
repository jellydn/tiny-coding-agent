import type { ModelCapabilities } from "./capabilities.js";
import { supportsThinking as modelRegistrySupportsThinking } from "./model-registry.js";
import type { OpenAIProviderConfig } from "./openai.js";
import { OpenAIProvider } from "./openai.js";
import type { ChatOptions, ChatResponse, StreamChunk } from "./types.js";

export interface QwenCloudProviderConfig {
	apiKey: string;
	baseUrl?: string;
}

const QWENCLOUD_BASE_URL = "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1";

function stripPrefix(model: string): string {
	return model.replace(/^qw\//, "");
}

/**
 * Per-model context-window and max-output-token fallback map.
 * Sourced from the QwenCloud model catalog (pi-qwencloud-provider).
 * Keyed by the bare model id (no `qw/` prefix).
 */
const QWENCLOUD_MODEL_CONTEXT: Record<string, { contextWindow: number; maxOutputTokens: number }> = {
	"qwen3.8-max-preview": { contextWindow: 262144, maxOutputTokens: 131072 },
	"qwen3.7-plus": { contextWindow: 1048576, maxOutputTokens: 131072 },
	"qwen3.7-max": { contextWindow: 262144, maxOutputTokens: 131072 },
	"qwen3.6-flash": { contextWindow: 131072, maxOutputTokens: 131072 },
	"deepseek-v4-pro": { contextWindow: 1000000, maxOutputTokens: 384000 },
	"glm-5.2": { contextWindow: 200000, maxOutputTokens: 131072 },
};

/**
 * QwenCloud (Token Plan) is an OpenAI-compatible endpoint whose model names
 * are prefixed with `qw/`. Inherits chat(), stream(), and tool-call buffering
 * from `OpenAIProvider`; overrides each method to strip the prefix before
 * delegating to super, plus a curated capability profile keyed under
 * "qwencloud" (context windows from the QwenCloud model catalog).
 */
export class QwenCloudProvider extends OpenAIProvider {
	private _qwenCapabilitiesCache = new Map<string, ModelCapabilities>();

	constructor(config: QwenCloudProviderConfig) {
		super({
			apiKey: config.apiKey,
			baseUrl: config.baseUrl ?? QWENCLOUD_BASE_URL,
		} satisfies OpenAIProviderConfig);
	}

	override async chat(options: ChatOptions): Promise<ChatResponse> {
		return super.chat({ ...options, model: stripPrefix(options.model) });
	}

	override async *stream(options: ChatOptions): AsyncGenerator<StreamChunk, void, unknown> {
		yield* super.stream({ ...options, model: stripPrefix(options.model) });
	}

	override async getCapabilities(model: string): Promise<ModelCapabilities> {
		const cached = this._qwenCapabilitiesCache.get(model);
		if (cached) return cached;

		const bareModel = stripPrefix(model);
		const hasThinking = modelRegistrySupportsThinking(model);
		const profile = QWENCLOUD_MODEL_CONTEXT[bareModel];

		const capabilities: ModelCapabilities = {
			modelName: model,
			supportsTools: true,
			supportsStreaming: true,
			supportsSystemPrompt: true,
			supportsToolStreaming: true,
			supportsThinking: hasThinking,
			contextWindow: profile?.contextWindow ?? 131072,
			maxOutputTokens: profile?.maxOutputTokens ?? 4096,
			isVerified: false,
			source: "fallback",
		};

		this._qwenCapabilitiesCache.set(model, capabilities);
		return capabilities;
	}
}
