import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
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

	// Write a commented YAML template with helpful examples
	const configTemplate = `# Tiny Agent Configuration
# See https://github.com/jellydn/tiny-coding-agent for full docs

# Default model to use
defaultModel: llama3.2

# Provider configurations
providers:
  ollama:
    baseUrl: http://localhost:11434
  # openai:
  #   apiKey: \${OPENAI_API_KEY}
  # anthropic:
  #   apiKey: \${ANTHROPIC_API_KEY}
  # opencode:
  #   apiKey: \${OPENCODE_API_KEY}

# MCP servers for extended capabilities
mcpServers:
  # Context7: Documentation lookups for libraries/frameworks (zero dependencies)
  context7:
    command: npx
    args: ["-y", "@upstash/context7-mcp"]

  # Serena: Semantic code operations (optional, requires uv)
  # Install: curl -LsSf https://astral.sh/uv/install.sh | sh
  # serena:
  #   command: uvx
  #   args:
  #     - "--from"
  #     - "git+https://github.com/oraios/serena"
  #     - "serena-mcp-server"
  #     - "--context"
  #     - "ide"
  #     - "--project"
  #     - "."
  #     - "--open-web-dashboard"
  #     - "false"

# Skill directories for custom skills
skillDirectories:
  - ~/.tiny-agent/skills/
  - .skills/

# Disable specific MCP tools by pattern (glob-style matching)
# disabledMcpPatterns:
#   - "mcp_serena_*memories*"    # Disable Serena memory tools
#   - "mcp_serena_*onboarding*"  # Disable Serena onboarding tools
`;

	writeFileSync(YAML_PATH, configTemplate, "utf-8");
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

function interpolateEnvVars(value: string, keyPath: string = ""): string {
	return value.replace(/\$\{([^}]+)\}/g, (_, envVar: string) => {
		const envValue = process.env[envVar];
		const isWhitelistedProvider =
			envVar.startsWith("OPENAI") ||
			envVar.startsWith("ANTHROPIC") ||
			envVar.startsWith("AWS") ||
			envVar.startsWith("OLLAMA") ||
			envVar.startsWith("OPENROUTER") ||
			envVar.startsWith("OPENCODE");

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
