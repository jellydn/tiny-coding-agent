import type { ProviderConfig } from "../config/schema.js";
import { createProvider } from "../providers/factory.js";
import { detectProvider } from "../providers/model-registry.js";
import type { LLMClient } from "../providers/types.js";

/**
 * Provider configuration map — keyed by provider type.
 * Moved here from agent.ts; re-exported from agent.ts for backward compat.
 */
export interface ProviderConfigs {
	openai?: ProviderConfig;
	anthropic?: ProviderConfig;
	ollama?: ProviderConfig;
	ollamaCloud?: ProviderConfig;
	openrouter?: ProviderConfig;
	opencode?: ProviderConfig;
	zai?: ProviderConfig;
	clinepass?: ProviderConfig;
	qwencloud?: ProviderConfig;
}

interface CacheEntry {
	client: LLMClient;
	timestamp: number;
	healthy: boolean;
}

const DEFAULT_CACHE_SIZE = 10;

/**
 * Encapsulates the provider client cache — previously inline fields and
 * methods on the Agent class (`_defaultLlmClient`, `_providerCache` Map,
 * `_providerCacheMaxSize`, `_evictOldestCacheEntry`, `_getLlmClientForModel`,
 * `_providerNameFor`).
 *
 * The cache maps a provider type string (e.g. "openai", "anthropic") to a
 * cached LLMClient instance. When a model is requested, the provider type
 * is detected via `detectProvider()`, the cache is checked, and a new client
 * is created via `createProvider()` on miss. Unhealthy entries are evicted,
 * and the cache has a max size with oldest-first eviction.
 */
export class ProviderCache {
	private readonly _defaultClient: LLMClient;
	private readonly _providerConfigs?: ProviderConfigs;
	private readonly _maxSize: number;
	private readonly _cache: Map<string, CacheEntry> = new Map();

	constructor(defaultClient: LLMClient, providerConfigs?: ProviderConfigs, maxSize?: number) {
		this._defaultClient = defaultClient;
		this._providerConfigs = providerConfigs;
		this._maxSize = maxSize ?? DEFAULT_CACHE_SIZE;
	}

	/** Number of entries currently in the cache. */
	get size(): number {
		return this._cache.size;
	}

	/**
	 * Get the LLM client for a model string. If provider configs are set,
	 * detects the provider type, checks the cache, and creates a new client
	 * on miss. Falls back to the default client when no configs are set or
	 * when provider creation fails.
	 */
	getClientForModel(model: string): LLMClient {
		if (!this._providerConfigs) return this._defaultClient;

		const providerType = detectProvider(model);
		const cached = this._cache.get(providerType);

		if (cached?.healthy) {
			cached.timestamp = Date.now();
			return cached.client;
		}

		if (cached && !cached.healthy) {
			this._cache.delete(providerType);
		}

		try {
			const client = createProvider({
				model,
				provider: providerType,
				providers: this._providerConfigs,
			});

			if (this._cache.size >= this._maxSize) {
				this._evictOldest();
			}

			this._cache.set(providerType, {
				client,
				timestamp: Date.now(),
				healthy: true,
			});
			return client;
		} catch (err) {
			const existing = this._cache.get(providerType);
			if (existing) {
				existing.healthy = false;
			}
			console.warn(`[ProviderCache] Failed to create provider for ${providerType}, falling back to default: ${err}`);
			return this._defaultClient;
		}
	}

	/**
	 * Detect the provider name for a model string, for log/span attributes.
	 * Wraps `detectProvider` with a try/catch so an unknown model string
	 * doesn't throw — returns "unknown" instead.
	 */
	getProviderName(model: string): string {
		try {
			return detectProvider(model);
		} catch {
			return "unknown";
		}
	}

	/** Evict the oldest cache entry (lowest timestamp). */
	private _evictOldest(): void {
		let oldestKey: string | null = null;
		let oldestTimestamp = Infinity;
		for (const [key, entry] of this._cache.entries()) {
			if (entry.timestamp < oldestTimestamp) {
				oldestTimestamp = entry.timestamp;
				oldestKey = key;
			}
		}
		if (oldestKey) {
			this._cache.delete(oldestKey);
		}
	}
}
