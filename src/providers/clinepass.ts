import type { ModelCapabilities } from "./capabilities.js";
import { OpenAIProvider } from "./openai.js";

export interface ClinePassProviderConfig {
	apiKey: string;
	baseUrl?: string;
}

/**
 * Default capability profile for a single ClinePass model id.
 *
 * ClinePass (https://github.com/jellydn/pi-clinepass-provider) does not
 * publish a model catalog we can introspect, and models.dev has no entries
 * under the "clinepass" key, so every curated model starts from this base
 * profile. A single source of truth means a future correction — e.g.,
 * bumping the context window uniformly across the curated list — is a
 * one-line change here rather than eight.
 */
const defaultClineCapabilities = (modelName: string): ModelCapabilities => ({
	modelName,
	supportsTools: true,
	supportsStreaming: true,
	supportsSystemPrompt: true,
	supportsToolStreaming: true,
	supportsThinking: true,
	contextWindow: 128000,
	maxOutputTokens: 8192,
	isVerified: false,
	source: "fallback",
});

/** Curated model ids exposed by the upstream ClinePass provider. */
const CLINEPASS_MODEL_IDS = [
	"cline-pass/glm-5.2",
	"cline-pass/deepseek-v4-pro",
	"cline-pass/deepseek-v4-flash",
	"cline-pass/kimi-k2.7-code",
	"cline-pass/kimi-k3",
	"cline-pass/qwen3.7-max",
	"cline-pass/qwen3.7-plus",
	"cline-pass/mimo-v2.5",
] as const;

const CLINEPASS_MODEL_CAPABILITIES: Record<string, ModelCapabilities> = Object.fromEntries(
	CLINEPASS_MODEL_IDS.map((id) => [id, defaultClineCapabilities(id)])
);

/**
 * ClinePass is an OpenAI-compatible gateway that fronts a curated list of
 * high-performance open-weight coding models behind a single API key.
 * Inherits chat() and stream() from `OpenAIProvider` with the ClinePass
 * base URL (`https://api.cline.bot/v1`).
 *
 * `getCapabilities` is overridden to look up hardcoded entries for the known
 * `cline-pass/*` model ids; unknown ids fall through to the OpenAI-derived
 * defaults inherited from `OpenAIProvider`, which still produce sensible
 * numbers for capability consumers.
 */
const DEFAULT_BASE_URL = "https://api.cline.bot/v1";

/** Resolves the baseUrl to use when none is supplied in the config.
 *  Single source of truth so the constructor's super call and the cached
 *  `_resolvedBaseUrl` field can never disagree. */
function resolveBaseUrl(config: ClinePassProviderConfig): string {
	return config.baseUrl || DEFAULT_BASE_URL;
}

export class ClinePassProvider extends OpenAIProvider {
	private readonly _resolvedBaseUrl: string;
	private _clinepassCapabilitiesCache = new Map<string, ModelCapabilities>();

	constructor(config: ClinePassProviderConfig) {
		const baseUrl = resolveBaseUrl(config);
		super({
			apiKey: config.apiKey,
			baseUrl,
		});
		this._resolvedBaseUrl = baseUrl;
	}

	/** Returns the baseUrl this provider was configured with.
	 *  Defaults to `https://api.cline.bot/v1` when none is supplied.
	 *
	 *  Contract: this value always equals the baseUrl that was forwarded
	 *  to the parent `OpenAIProvider` constructor — both come from the
	 *  same `resolveBaseUrl(config)` call, so the two cannot drift.
	 *
	 *  Intended for health checks and for tests that need to assert the
	 *  parent saw the same URL. */
	getResolvedBaseUrl(): string {
		return this._resolvedBaseUrl;
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
