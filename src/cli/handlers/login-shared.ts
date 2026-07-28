/**
 * login-shared.ts — pure functions, types, and constants for the login/logout
 * command surface. No I/O, no prompts, no process.exit() — directly testable.
 *
 * Extracted from login.ts (ADR-016 decomposition) to break the circular
 * dependency that would arise if login-flow.ts imported pure functions from
 * login.ts while login.ts imported flow functions from login-flow.ts.
 *
 * Both login.ts (handler wrappers) and login-flow.ts (interactive flows)
 * import from this module. login.ts re-exports everything for backward
 * compatibility — tests and other modules import from login.ts unchanged.
 */

import type { Config } from "../../config/schema.js";
import { detectProvider } from "../../providers/model-registry.js";

// ===== Types & Constants =====

export interface LoginProviderInfo {
	key: string;
	name: string;
	requiresApiKey: boolean;
	envVar?: string;
	defaultModel?: string;
	getKeyUrl?: string;
	note?: string;
}

/**
 * Providers available for login, ordered by popularity for the onboarding
 * picker. Keys match the `providers` object in config.yaml (see
 * `Config["providers"]` in schema.ts).
 */
export const LOGIN_PROVIDERS: readonly LoginProviderInfo[] = [
	{
		key: "openai",
		name: "OpenAI",
		requiresApiKey: true,
		envVar: "OPENAI_API_KEY",
		defaultModel: "gpt-4o",
		getKeyUrl: "https://platform.openai.com/api-keys",
	},
	{
		key: "anthropic",
		name: "Anthropic",
		requiresApiKey: true,
		envVar: "ANTHROPIC_API_KEY",
		defaultModel: "claude-sonnet-4-20250514",
		getKeyUrl: "https://console.anthropic.com/settings/keys",
	},
	{
		key: "ollama",
		name: "Ollama (Local)",
		requiresApiKey: false,
		defaultModel: "qwen3-coder",
		note: "Runs locally — no API key needed. Install from ollama.com",
	},
	{
		key: "ollamaCloud",
		name: "Ollama (Cloud)",
		requiresApiKey: true,
		envVar: "OLLAMA_CLOUD_API_KEY",
		defaultModel: "gpt-oss:120b-cloud",
		getKeyUrl: "https://ollama.com",
	},
	{
		key: "openrouter",
		name: "OpenRouter",
		requiresApiKey: true,
		envVar: "OPENROUTER_API_KEY",
		defaultModel: "openrouter/openai/gpt-4o",
		getKeyUrl: "https://openrouter.ai/keys",
	},
	{
		key: "opencode",
		name: "OpenCode",
		requiresApiKey: true,
		envVar: "OPENCODE_API_KEY",
		defaultModel: "opencode/big-pickle",
		getKeyUrl: "https://opencode.ai",
	},
	{
		key: "zai",
		name: "Z.AI (Zhipu)",
		requiresApiKey: true,
		envVar: "ZAI_API_KEY",
		defaultModel: "glm-4.7",
		getKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
	},
	{
		key: "clinepass",
		name: "ClinePass",
		requiresApiKey: true,
		envVar: "CLINE_API_KEY",
		defaultModel: "cline-pass/glm-5.2",
		getKeyUrl: "https://cline.bot",
	},
	{
		key: "qwencloud",
		name: "QwenCloud",
		requiresApiKey: true,
		envVar: "QWENCLOUD_API_KEY",
		defaultModel: "qw/glm-5.2",
		getKeyUrl: "https://home.qwencloud.com",
	},
];

export interface ProviderStatus {
	key: string;
	name: string;
	configured: boolean;
	hasApiKey: boolean;
	requiresApiKey: boolean;
}

// ===== Pure Functions (no I/O — directly testable) =====

/** Find a login provider by key (case-insensitive). */
export function findProvider(key: string): LoginProviderInfo | undefined {
	const lower = key.toLowerCase();
	return LOGIN_PROVIDERS.find((p) => p.key.toLowerCase() === lower);
}

/** Compute connection status for every provider from a config's providers object. */
export function getProviderStatus(providers: Config["providers"] | undefined): ProviderStatus[] {
	return LOGIN_PROVIDERS.map((p) => {
		const providerConfig = providers?.[p.key as keyof NonNullable<typeof providers>];
		const configured = !!providerConfig;
		const hasApiKey = !!providerConfig?.apiKey;
		return {
			key: p.key,
			name: p.name,
			configured,
			hasApiKey,
			requiresApiKey: p.requiresApiKey,
		};
	});
}

export interface ApplyProviderOptions {
	apiKey?: string;
	baseUrl?: string;
	defaultModel?: string;
}

/**
 * Merge a provider configuration into a raw config object (as read from the
 * config file). Preserves all existing keys (other providers, mcpServers,
 * skillDirectories, etc.) and only adds/overwrites the target provider +
 * optional defaultModel. Does NOT mutate the input.
 */
export function applyProviderToConfig(
	fileConfig: Record<string, unknown>,
	providerKey: string,
	options: ApplyProviderOptions
): Record<string, unknown> {
	const result: Record<string, unknown> = { ...fileConfig };

	// Shallow-copy the providers object so we don't mutate the input
	const existingProviders =
		result.providers && typeof result.providers === "object"
			? { ...(result.providers as Record<string, unknown>) }
			: {};
	result.providers = existingProviders;

	const providers = existingProviders as Record<string, Record<string, unknown>>;
	// Copy the existing provider entry to avoid mutation
	const existing = { ...(providers[providerKey] ?? {}) };

	const updated: Record<string, unknown> = { ...existing };
	if (options.apiKey !== undefined) {
		updated.apiKey = options.apiKey;
	}
	if (options.baseUrl !== undefined) {
		updated.baseUrl = options.baseUrl;
	}
	providers[providerKey] = updated;

	if (options.defaultModel !== undefined) {
		result.defaultModel = options.defaultModel;
	}

	return result;
}

/** Format provider connection status as a human-readable string. */
export function formatProviderStatus(providers: Config["providers"] | undefined): string {
	const statuses = getProviderStatus(providers);
	const lines: string[] = ["Provider Connection Status", "========================"];

	for (const s of statuses) {
		const icon = s.hasApiKey || (!s.requiresApiKey && s.configured) ? "●" : s.configured ? "◐" : "○";
		let statusText: string;
		if (s.requiresApiKey) {
			statusText = s.hasApiKey ? "API key set" : s.configured ? "API key required" : "not configured";
		} else {
			statusText = s.configured ? "ready" : "ready (local)";
		}
		lines.push(`  ${icon} ${s.name.padEnd(16)} ${statusText}`);
	}

	return lines.join("\n");
}

/**
 * Remove the `apiKey` from a provider's config entry, preserving `baseUrl`
 * and any other fields. Does NOT delete the provider entry itself — the
 * provider stays "configured" (e.g. with a custom baseUrl) but is
 * "disconnected" (no key). Does NOT mutate the input.
 *
 * If the provider has no apiKey or no entry at all, the config is returned
 * unchanged (idempotent for the "already logged out" state).
 */
export function removeApiKeyFromConfig(
	fileConfig: Record<string, unknown>,
	providerKey: string
): Record<string, unknown> {
	const result: Record<string, unknown> = { ...fileConfig };

	const existingProviders =
		result.providers && typeof result.providers === "object"
			? { ...(result.providers as Record<string, unknown>) }
			: {};
	result.providers = existingProviders;

	const providers = existingProviders as Record<string, Record<string, unknown>>;
	const existing = providers[providerKey];
	if (!existing || typeof existing !== "object") {
		return result;
	}

	// Shallow-copy and delete the apiKey key
	const updated: Record<string, unknown> = { ...existing };
	delete updated.apiKey;
	providers[providerKey] = updated;

	return result;
}

/**
 * Check if the given provider key matches the provider that the current
 * `defaultModel` auto-detects to. Returns false if no defaultModel is set
 * or if detectProvider throws.
 */
export function isActiveProvider(providerKey: string, defaultModel: unknown): boolean {
	if (typeof defaultModel !== "string" || !defaultModel) return false;
	try {
		return detectProvider(defaultModel) === providerKey;
	} catch {
		return false;
	}
}
