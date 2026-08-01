/**
 * config-env.ts — environment variable interpolation and overrides for tiny-agent config.
 *
 * Extracted from loader.ts (Round 7 Candidate #3 part 2) so the env-var
 * resolution logic is independently testable and loader.ts focuses on
 * file I/O and config merging.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { Config } from "./schema.js";

// ─── Security patterns ──────────────────────────────────────────────────────

const SENSITIVE_KEY_PATTERNS = [
	/api[_-]?key/i,
	/secret/i,
	/password/i,
	/token/i,
	/credential/i,
	/auth/i,
	/private[_-]?key/i,
	/access[_-]?key/i,
];

function containsSensitivePattern(key: string): boolean {
	return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Provider-specific env vars allowed outside the prefix-based whitelist.
 * Each entry is matched exactly (no prefix), so a future addition requires
 * an explicit `ALLOWED_PROVIDER_ENV_VARS` row rather than a blanket prefix
 * that would whitelisten unrelated env vars.
 */
const ALLOWED_PROVIDER_ENV_VARS: readonly string[] = ["CLINE_API_KEY", "CLINEPASS_API_KEY"];

// ─── Env-var interpolation ──────────────────────────────────────────────────

/**
 * Replace `${VAR_NAME}` placeholders in a string with the corresponding
 * environment variable values. Throws if a referenced env var is not set.
 * Warns if a non-whitelisted env var appears to reference sensitive data.
 */
function interpolateEnvVars(value: string, keyPath: string = ""): string {
	return value.replace(/\$\{([^}]+)\}/g, (_, envVar: string) => {
		const envValue = process.env[envVar];
		const isWhitelistedProvider =
			envVar.startsWith("OPENAI") ||
			envVar.startsWith("ANTHROPIC") ||
			envVar.startsWith("AWS") ||
			envVar.startsWith("OLLAMA") ||
			envVar.startsWith("OPENROUTER") ||
			envVar.startsWith("OPENCODE") ||
			envVar.startsWith("ZAI") ||
			ALLOWED_PROVIDER_ENV_VARS.includes(envVar);

		if (!isWhitelistedProvider && containsSensitivePattern(keyPath)) {
			console.warn(
				`[Security Warning] Config key "${keyPath}" appears to contain sensitive data. ` +
					`Ensure this value is not logged or exposed in error messages.`
			);
		}
		if (!envValue) {
			throw new Error(`Environment variable ${envVar} is not set`);
		}
		return envValue;
	});
}

/**
 * Recursively walk an object and interpolate env-vars in all string values.
 */
export function interpolateObject(obj: unknown, keyPath: string = ""): unknown {
	if (typeof obj === "string") return interpolateEnvVars(obj, keyPath);
	if (obj === null || typeof obj !== "object") return obj;
	if (Array.isArray(obj)) {
		return obj.map((item, index) => interpolateObject(item, `${keyPath}[${index}]`));
	}

	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
		const newKeyPath = keyPath ? `${keyPath}.${key}` : key;
		result[key] = interpolateObject(value, newKeyPath);
	}
	return result;
}

// ─── Env-var overrides ──────────────────────────────────────────────────────

interface OverrideDef {
	key: string;
	envVar: string;
	parse?: (v: string) => number;
}

const CONFIG_OVERRIDES: readonly OverrideDef[] = [
	{ key: "defaultModel", envVar: "TINY_AGENT_MODEL" },
	{ key: "systemPrompt", envVar: "TINY_AGENT_SYSTEM_PROMPT" },
	{ key: "conversationFile", envVar: "TINY_AGENT_CONVERSATION_FILE" },
	{ key: "memoryFile", envVar: "TINY_AGENT_MEMORY_FILE" },
	{
		key: "maxContextTokens",
		envVar: "TINY_AGENT_MAX_CONTEXT_TOKENS",
		parse: (v) => parseInt(v, 10),
	},
	{
		key: "maxMemoryTokens",
		envVar: "TINY_AGENT_MAX_MEMORY_TOKENS",
		parse: (v) => parseInt(v, 10),
	},
];

/**
 * Apply config overrides from environment variables (e.g. TINY_AGENT_MODEL).
 * Returns a new Config with the overrides applied.
 */
export function applyConfigOverrides(config: Config): Config {
	let result = config;

	for (const override of CONFIG_OVERRIDES) {
		const envValue = process.env[override.envVar];
		if (envValue) {
			if (override.parse) {
				const parsed = override.parse(envValue);
				if (!Number.isNaN(parsed) && parsed > 0) {
					result = { ...result, [override.key]: parsed };
				}
			} else {
				result = { ...result, [override.key]: envValue };
			}
		}
	}

	return result;
}

// ─── Observability overrides ────────────────────────────────────────────────

function envBool(v: string | undefined): boolean | undefined {
	if (v === undefined) return undefined;
	return /^(1|true|yes|on)$/i.test(v.trim());
}

function envNum(v: string | undefined): number | undefined {
	if (v === undefined) return undefined;
	const n = Number(v);
	return Number.isFinite(n) ? n : undefined;
}

/**
 * Apply observability overrides from environment variables.
 * These take precedence over config-file values so observability can be
 * tuned per-environment without editing the config file.
 */
export function applyObservabilityOverrides(config: Config): Config {
	const observability: Required<NonNullable<Config["observability"]>> = {
		telemetryEnabled: true,
		langfuseEnabled: false,
		logFullPrompts: false,
		previewLength: 200,
		detailedResponseMeta: true,
		...config.observability,
	};

	const telemetryEnv = envBool(process.env.TINY_AGENT_TELEMETRY_ENABLED);
	if (telemetryEnv !== undefined) observability.telemetryEnabled = telemetryEnv;
	const langfuseEnv = envBool(process.env.TINY_AGENT_LANGFUSE_ENABLED);
	if (langfuseEnv !== undefined) observability.langfuseEnabled = langfuseEnv;
	const fullPromptsEnv = envBool(process.env.TINY_AGENT_LOG_FULL_PROMPTS);
	if (fullPromptsEnv !== undefined) observability.logFullPrompts = fullPromptsEnv;
	const previewLenEnv = envNum(process.env.TINY_AGENT_PREVIEW_LENGTH);
	if (previewLenEnv !== undefined && previewLenEnv > 0) observability.previewLength = previewLenEnv;
	const detailedMetaEnv = envBool(process.env.TINY_AGENT_DETAILED_RESPONSE_META);
	if (detailedMetaEnv !== undefined) observability.detailedResponseMeta = detailedMetaEnv;

	return { ...config, observability };
}

// ─── Skill directory expansion ──────────────────────────────────────────────

/**
 * Expand `~/` prefixes in skill directory paths to the user's home directory.
 */
export function expandSkillDirectories(config: Config): Config {
	if (!config.skillDirectories) return config;

	return {
		...config,
		skillDirectories: config.skillDirectories.map((dir) =>
			dir.startsWith("~/") ? join(homedir(), dir.slice(2)) : dir
		),
	};
}
