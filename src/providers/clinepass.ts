import type { ModelCapabilities } from "./capabilities.js";
import { OpenAIProvider } from "./openai.js";

export interface ClinePassProviderConfig {
	apiKey: string;
	baseUrl?: string;
}

/**
 * Hardcoded capability table for the curated models exposed by ClinePass.
 * ClinePass does not publish a model catalog we can introspect, and models.dev
 * has no entries under the "clinepass" key, so we ship a hand-maintained
 * table for the models documented by the upstream provider
 * (https://github.com/jellydn/pi-clinepass-provider). When a model id matches
 * one of these entries we report those numbers; otherwise we fall through to
 * the OpenAI-derived defaults inherited from `OpenAIProvider`, which still
 * produce reasonable (if generic) numbers for capability consumers.
 */
const CLINEPASS_MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
	"cline-pass/glm-5.2": {
		modelName: "cline-pass/glm-5.2",
		supportsTools: true,
		supportsStreaming: true,
		supportsSystemPrompt: true,
		supportsToolStreaming: true,
		supportsThinking: true,
		contextWindow: 128000,
		maxOutputTokens: 8192,
		isVerified: false,
		source: "fallback",
	},
	"cline-pass/deepseek-v4-pro": {
		modelName: "cline-pass/deepseek-v4-pro",
		supportsTools: true,
		supportsStreaming: true,
		supportsSystemPrompt: true,
		supportsToolStreaming: true,
		supportsThinking: true,
		contextWindow: 128000,
		maxOutputTokens: 8192,
		isVerified: false,
		source: "fallback",
	},
	"cline-pass/deepseek-v4-flash": {
		modelName: "cline-pass/deepseek-v4-flash",
		supportsTools: true,
		supportsStreaming: true,
		supportsSystemPrompt: true,
		supportsToolStreaming: true,
		supportsThinking: true,
		contextWindow: 128000,
		maxOutputTokens: 8192,
		isVerified: false,
		source: "fallback",
	},
	"cline-pass/kimi-k2.7-code": {
		modelName: "cline-pass/kimi-k2.7-code",
		supportsTools: true,
		supportsStreaming: true,
		supportsSystemPrompt: true,
		supportsToolStreaming: true,
		supportsThinking: true,
		contextWindow: 128000,
		maxOutputTokens: 8192,
		isVerified: false,
		source: "fallback",
	},
	"cline-pass/kimi-k3": {
		modelName: "cline-pass/kimi-k3",
		supportsTools: true,
		supportsStreaming: true,
		supportsSystemPrompt: true,
		supportsToolStreaming: true,
		supportsThinking: true,
		contextWindow: 128000,
		maxOutputTokens: 8192,
		isVerified: false,
		source: "fallback",
	},
	"cline-pass/qwen3.7-max": {
		modelName: "cline-pass/qwen3.7-max",
		supportsTools: true,
		supportsStreaming: true,
		supportsSystemPrompt: true,
		supportsToolStreaming: true,
		supportsThinking: true,
		contextWindow: 128000,
		maxOutputTokens: 8192,
		isVerified: false,
		source: "fallback",
	},
	"cline-pass/qwen3.7-plus": {
		modelName: "cline-pass/qwen3.7-plus",
		supportsTools: true,
		supportsStreaming: true,
		supportsSystemPrompt: true,
		supportsToolStreaming: true,
		supportsThinking: true,
		contextWindow: 128000,
		maxOutputTokens: 8192,
		isVerified: false,
		source: "fallback",
	},
	"cline-pass/mimo-v2.5": {
		modelName: "cline-pass/mimo-v2.5",
		supportsTools: true,
		supportsStreaming: true,
		supportsSystemPrompt: true,
		supportsToolStreaming: true,
		supportsThinking: true,
		contextWindow: 128000,
		maxOutputTokens: 8192,
		isVerified: false,
		source: "fallback",
	},
};

/**
 * ClinePass (https://github.com/jellydn/pi-clinepass-provider) is an
 * OpenAI-compatible gateway that fronts a curated list of high-performance
 * open-weight coding models behind a single API key. Inherits chat() and
 * stream() from `OpenAIProvider` with the ClinePass base URL
 * (`https://api.cline.bot/v1`).
 *
 * `getCapabilities` is overridden to look up hardcoded entries for the known
 * `cline-pass/*` model ids; unknown ids fall through to the OpenAI-derived
 * defaults inherited from `OpenAIProvider`, which still produce sensible
 * numbers for capability consumers.
 */
export class ClinePassProvider extends OpenAIProvider {
	private _clinepassCapabilitiesCache = new Map<string, ModelCapabilities>();

	constructor(config: ClinePassProviderConfig) {
		super({
			apiKey: config.apiKey,
			baseUrl: config.baseUrl || "https://api.cline.bot/v1",
		});
	}

	override async getCapabilities(model: string): Promise<ModelCapabilities> {
		const cached = this._clinepassCapabilitiesCache.get(model);
		if (cached) return cached;

		const known = CLINEPASS_MODEL_CAPABILITIES[model];
		if (known) {
			this._clinepassCapabilitiesCache.set(model, known);
			return known;
		}

		return super.getCapabilities(model);
	}
}
