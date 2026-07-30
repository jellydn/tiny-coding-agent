import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { generateDefaultYaml } from "./config-template.js";
import type { Config } from "./schema.js";
import { validateConfig } from "./schema.js";

export const CONFIG_DIR = join(homedir(), ".tiny-agent");

export function getYamlPath(): string {
	return process.env.TINY_AGENT_CONFIG_YAML ?? join(CONFIG_DIR, "config.yaml");
}

export function getJsonPath(): string {
	return process.env.TINY_AGENT_CONFIG_JSON ?? join(CONFIG_DIR, "config.json");
}

export const YAML_PATH = getYamlPath();
export const JSON_PATH = getJsonPath();

export function getConfigPath(): string {
	const yamlPath = getYamlPath();
	if (existsSync(yamlPath)) return yamlPath;
	const jsonPath = getJsonPath();
	return existsSync(jsonPath) ? jsonPath : yamlPath;
}

const SYSTEM_PROMPT = `You are a helpful AI coding assistant with access to tools. Use available tools to help the user.

IMPORTANT GUIDELINES:
- For version queries (e.g., "latest version"), always verify from authoritative sources like npmjs.com, GitHub releases, or official documentation
- When citing version numbers or facts, mention the source (e.g., "According to npmjs.com...")
- If search results seem unreliable or conflicting, acknowledge the uncertainty
- Do not conflate different technologies (e.g., Zod with Python)
- For breaking changes, consult official changelogs or release notes

When you have enough information to answer, provide your final response.`;
function getDefaultConfig(): Config {
	return {
		defaultModel: "llama3.2",
		systemPrompt: SYSTEM_PROMPT,
		trackContextUsage: true,
		maxContextTokens: 32000,
		providers: {
			ollama: {
				baseUrl: "http://localhost:11434",
			},
		},
		skillDirectories: ["~/.tiny-agent/skills/", "./.skills/"],
		mcpServers: {
			context7: {
				command: "npx",
				args: ["-y", "@upstash/context7-mcp"],
			},
		},
		tools: {},
	};
}

function createDefaultConfig(): void {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, { recursive: true });
	}

	const configTemplate = generateDefaultYaml();

	// Write with owner-only permissions (0o600) so the config file — which
	// may later hold literal API keys after `tiny-agent login` — is not
	// world-readable. The default template only has commented-out env-var
	// references, but writing secure-by-default means the permissions are
	// correct from the moment the file is created.
	writeFileSync(YAML_PATH, configTemplate, { mode: 0o600, encoding: "utf-8" });
}

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

function interpolateObject(obj: unknown, keyPath: string = ""): unknown {
	if (obj === null || typeof obj !== "object") return obj;
	if (typeof obj === "string") return interpolateEnvVars(obj, keyPath);
	if (Array.isArray(obj)) return obj.map((item, index) => interpolateObject(item, `${keyPath}[${index}]`));

	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj)) {
		const newKeyPath = keyPath ? `${keyPath}.${key}` : key;
		result[key] = interpolateObject(value, newKeyPath);
	}
	return result;
}

export function loadConfig(): Config {
	let rawConfig: unknown;
	let configSource = "default config";

	const yamlPath = getYamlPath();
	const jsonPath = getJsonPath();

	if (existsSync(yamlPath)) {
		configSource = yamlPath;
		const content = readFileSync(yamlPath, "utf-8");
		rawConfig = parseYaml(content);
	} else if (existsSync(jsonPath)) {
		configSource = jsonPath;
		const content = readFileSync(jsonPath, "utf-8");
		rawConfig = JSON.parse(content);
	} else {
		createDefaultConfig();
		const content = readFileSync(yamlPath, "utf-8");
		rawConfig = parseYaml(content);
	}

	// Merge with defaults for missing fields (supports new features added after config was created)
	const defaultConfig = getDefaultConfig();
	const userConfig = rawConfig as Record<string, unknown>;
	const mergedConfig = {
		...defaultConfig,
		...userConfig,
		// Deep merge nested objects
		providers: {
			...defaultConfig.providers,
			...(userConfig.providers as Record<string, unknown>),
		},
		// Only add default MCP servers if user has NO mcpServers config at all
		// If user defines any mcpServers, use only those (opt-in model)
		...(userConfig.mcpServers === undefined ? { mcpServers: defaultConfig.mcpServers } : {}),
		// Merge arrays (skillDirectories)
		skillDirectories: userConfig.skillDirectories ?? defaultConfig.skillDirectories,
		// Merge tools object
		tools: userConfig.tools ?? defaultConfig.tools,
	};

	const interpolatedConfig = interpolateObject(mergedConfig);

	const errors = validateConfig(interpolatedConfig);
	if (errors.length > 0) {
		const errorMessages = errors.map((e) => `  - ${e.field}: ${e.message}`).join("\n");
		throw new Error(`Invalid config at ${configSource}:\n${errorMessages}`);
	}

	console.warn(
		`[Security] For sensitive configuration values (API keys, tokens), ` +
			`use environment variables with \${VAR_NAME} syntax instead of hardcoding values.`
	);

	let config = interpolatedConfig as Config;

	const overrides: Array<{ key: string; envVar: string; parse?: (v: string) => number }> = [
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

	for (const override of overrides) {
		const envValue = process.env[override.envVar];
		if (envValue) {
			if (override.parse) {
				const parsed = override.parse(envValue);
				if (!Number.isNaN(parsed) && parsed > 0) {
					config = { ...config, [override.key]: parsed };
				}
			} else {
				config = { ...config, [override.key]: envValue };
			}
		}
	}

	// Observability env-var overrides. These take precedence over config-file
	// values so observability can be tuned per-environment without editing the
	// config file. All are optional and fall back to safe defaults.
	const observability: Required<NonNullable<Config["observability"]>> = {
		telemetryEnabled: true,
		langfuseEnabled: false,
		logFullPrompts: false,
		previewLength: 200,
		detailedResponseMeta: true,
		...config.observability,
	};
	const envBool = (v: string | undefined): boolean | undefined => {
		if (v === undefined) return undefined;
		return /^(1|true|yes|on)$/i.test(v.trim());
	};
	const envNum = (v: string | undefined): number | undefined => {
		if (v === undefined) return undefined;
		const n = Number(v);
		return Number.isFinite(n) ? n : undefined;
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
	config = { ...config, observability };

	if (config.skillDirectories) {
		config.skillDirectories = config.skillDirectories.map((dir) =>
			dir.startsWith("~/") ? join(homedir(), dir.slice(2)) : dir
		);
	}

	return config;
}

export function loadAgentsMd(filePath?: string): string | null {
	const agentsPath = filePath || join(process.cwd(), "AGENTS.md");
	if (existsSync(agentsPath)) {
		return readFileSync(agentsPath, "utf-8");
	}
	return null;
}
