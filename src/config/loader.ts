import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { applyConfigOverrides, applyObservabilityOverrides, expandSkillDirectories, interpolateObject } from "./config-env.js";
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

	config = applyConfigOverrides(config);
	config = applyObservabilityOverrides(config);
	config = expandSkillDirectories(config);

	return config;
}

export function loadAgentsMd(filePath?: string): string | null {
	const agentsPath = filePath || join(process.cwd(), "AGENTS.md");
	if (existsSync(agentsPath)) {
		return readFileSync(agentsPath, "utf-8");
	}
	return null;
}
