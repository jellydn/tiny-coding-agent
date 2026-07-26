import type { ModelCapabilities } from "./capabilities.js";
import { OpenAIProvider } from "./openai.js";

export interface ClinePassProviderConfig {
	apiKey: string;
	baseUrl?: string;
}

/**
 * Default capability profile for a single ClinePass model id.
 *
 * The Cline API's GET /api/v1/models endpoint returns an OpenAI-compatible
 * list of model ids but does NOT include per-model capabilities (context
 * window, max output tokens, etc.). So when a model id is confirmed to be
 * in the upstream list, we apply a curated default profile that matches
 * the documented behavior of ClinePass (curated open-weight coding models,
 * all with tools, streaming, thinking).
 *
 * This factory is the single source of truth for that profile: a future
 * correction (e.g., bumping the context window uniformly across the
 * curated list) is a one-line change here.
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
	// `isVerified: true` because the model id was confirmed by the live
	// upstream list (not inferred from defaults). `source: "api"`
	// distinguishes this from a "fallback" / "catalog" entry.
	isVerified: true,
	source: "api",
});

const DEFAULT_BASE_URL = "https://api.cline.bot/v1";

/** Resolves the baseUrl to use when none is supplied in the config.
 *  Single source of truth so the constructor's super call and the cached
 *  `_resolvedBaseUrl` field can never disagree. */
function resolveBaseUrl(config: ClinePassProviderConfig): string {
	return config.baseUrl || DEFAULT_BASE_URL;
}

/**
 * Derive the URL for the ClinePass GET /api/v1/models endpoint from the
 * configured baseUrl. The OpenAI SDK's baseUrl is e.g. "https://api.cline.bot/v1",
 * and the Cline API exposes the models endpoint at a separate "/api/v1/models"
 * path on the origin (NOT under the SDK's "/v1/" path). We strip the trailing
 * "/v1" from the baseUrl and append "/api/v1/models".
 *
 * String replacement (rather than `URL.origin`) handles custom deployments
 * that use a path prefix, e.g. "https://corp.proxy/clinepass/v1" ->
 * "https://corp.proxy/clinepass/api/v1/models". `URL.origin` would drop the
 * "/clinepass" prefix.
 */
function getModelsListUrl(baseUrl: string): string {
	return baseUrl.replace(/\/v1\/?$/, "/api/v1/models");
}

interface ClinePassModelListResponse {
	// Honest type: the upstream may mis-shape `data` (object/string/null),
	// so we runtime-narrow via `Array.isArray(payload.data)` before iterating.
	data?: unknown;
}

/**
 * ClinePass is an OpenAI-compatible gateway that fronts a curated list of
 * high-performance open-weight coding models behind a single API key.
 * Inherits chat() and stream() from `OpenAIProvider` with the ClinePass
 * base URL (`https://api.cline.bot/v1`).
 *
 * `getCapabilities` is overridden to consult the live model list exposed
 * by the Cline API at `/api/v1/models`. The list is fetched once per
 * provider instance (memoized at the provider level via a shared promise)
 * and per-id on top (memoized at the per-id level so repeated calls are
 * O(1)). On any network or non-200 response, we fall through to the
 * OpenAI-derived defaults inherited from `OpenAIProvider`, so callers
 * still get sensible numbers when the upstream is unreachable.
 *
 * New model ids added upstream automatically appear in the response; we
 * apply the same `defaultClineCapabilities` profile to each.
 */
export class ClinePassProvider extends OpenAIProvider {
	private readonly _resolvedBaseUrl: string;
	private readonly _apiKey: string;
	private _capabilitiesByModelId = new Map<string, ModelCapabilities>();
	private _modelsListPromise: Promise<Set<string>> | null = null;

	constructor(config: ClinePassProviderConfig) {
		const baseUrl = resolveBaseUrl(config);
		super({
			apiKey: config.apiKey,
			baseUrl,
		});
		this._resolvedBaseUrl = baseUrl;
		this._apiKey = config.apiKey;
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
		// Per-id cache: subsequent calls for the same model are O(1).
		const cached = this._capabilitiesByModelId.get(model);
		if (cached) return cached;

		const isInLiveList = await this._isModelInLiveList(model);

		// Resolve capabilities from the live list (if the model id is
		// confirmed upstream) or fall through to the OpenAI-derived
		// defaults for unknown ids. Caching the negative (not-in-list)
		// path is intentional: re-confirming a known-unknown id on every
		// call would re-issue the list promise and re-run the super
		// fallback for no benefit.
		const caps = isInLiveList ? defaultClineCapabilities(model) : await super.getCapabilities(model);

		// Only cache on list-fetch success — see `_getModelsList` for
		// why a post-await null `_modelsListPromise` means "retry the fetch".
		if (this._modelsListPromise !== null) {
			this._capabilitiesByModelId.set(model, caps);
		}

		return caps;
	}

	/** Resolve whether `model` is in the live upstream list. Returns
	 *  false on any error (network, non-200, malformed payload) so the
	 *  caller falls through to the OpenAI-derived defaults. */
	private async _isModelInLiveList(model: string): Promise<boolean> {
		try {
			const set = await this._getModelsList();
			return set.has(model);
		} catch {
			return false;
		}
	}

	/** Per-instance memoization of the upstream model list. The promise
	 *  is shared across all calls so parallel `getCapabilities()` calls
	 *  collapse to a single network request. On failure the promise is
	 *  cleared so the next call retries. */
	private _getModelsList(): Promise<Set<string>> {
		if (!this._modelsListPromise) {
			const promise = this._fetchModelsList();
			this._modelsListPromise = promise;
			// Clear on failure so the next call retries the fetch.
			// The .catch handler is registered BEFORE the await in
			// `_isModelInLiveList`, so on a rejection this null-clear
			// runs first and the await observes `_modelsListPromise === null`
			// when it resumes.
			promise.catch(() => {
				this._modelsListPromise = null;
			});
		}
		return this._modelsListPromise;
	}

	private async _fetchModelsList(): Promise<Set<string>> {
		const url = getModelsListUrl(this._resolvedBaseUrl);
		const response = await fetch(url, {
			headers: {
				Authorization: `Bearer ${this._apiKey}`,
			},
		});
		if (!response.ok) {
			throw new Error(`ClinePass /api/v1/models responded ${response.status}`);
		}
		const payload = (await response.json()) as ClinePassModelListResponse;
		// `Array.isArray` guards against upstream proxies that return
		// `data` as a JSON object/string instead of an array — in that
		// case we treat the list as empty and fall through to the
		// OpenAI-derived defaults (caught by `_isModelInLiveList`'s try).
		const data = Array.isArray(payload.data) ? payload.data : [];
		// Optional-chaining on `m?.id` handles null/undefined entries
		// inside the array without killing the whole list.
		const ids = data.map((m) => m?.id).filter((id): id is string => typeof id === "string");
		return new Set(ids);
	}
}
