import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { Config } from "./schema.js";
import { validateConfig } from "./schema.js";

export const CONFIG_DIR = join(homedir(), ".tiny-agent");
export const YAML_PATH = join(CONFIG_DIR, "config.yaml");
export const JSON_PATH = join(CONFIG_DIR, "config.json");

export function getConfigPath(): string {
  if (existsSync(YAML_PATH)) {
    return YAML_PATH;
  }
  if (existsSync(JSON_PATH)) {
    return JSON_PATH;
  }
  return YAML_PATH;
}

const SYSTEMS_PROMPT = `You are a helpful AI coding assistant with access to tools. Use available tools to help the user.

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
    systemPrompt: SYSTEMS_PROMPT,
    providers: {
      ollama: {
        baseUrl: "http://localhost:11434",
      },
    },
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

  const defaultConfig = getDefaultConfig();
  const configContent = stringifyYaml(defaultConfig);
  writeFileSync(YAML_PATH, configContent, "utf-8");
}

function interpolateEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, envVar: string) => {
    const envValue = process.env[envVar];
    if (envValue === undefined) {
      throw new Error(`Environment variable ${envVar} is not set`);
    }
    return envValue;
  });
}

function interpolateObject(obj: unknown): unknown {
  if (typeof obj === "string") {
    return interpolateEnvVars(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(interpolateObject);
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = interpolateObject(value);
    }
    return result;
  }
  return obj;
}

export function loadConfig(): Config {
  let configPath: string | null = null;
  let rawConfig: unknown;

  if (existsSync(YAML_PATH)) {
    configPath = YAML_PATH;
    const content = readFileSync(YAML_PATH, "utf-8");
    rawConfig = parseYaml(content);
  } else if (existsSync(JSON_PATH)) {
    configPath = JSON_PATH;
    const content = readFileSync(JSON_PATH, "utf-8");
    rawConfig = JSON.parse(content);
  } else {
    createDefaultConfig();
    const content = readFileSync(YAML_PATH, "utf-8");
    rawConfig = parseYaml(content);
    configPath = YAML_PATH;
  }

  const interpolatedConfig = interpolateObject(rawConfig);

  const errors = validateConfig(interpolatedConfig);
  if (errors.length > 0) {
    const errorMessages = errors
      .map((e: { field: string; message: string }) => `  - ${e.field}: ${e.message}`)
      .join("\n");
    throw new Error(`Invalid config at ${configPath}:\n${errorMessages}`);
  }

  let config = interpolatedConfig as Config;

  const modelOverride = process.env.TINY_AGENT_MODEL;
  if (modelOverride) {
    config = { ...config, defaultModel: modelOverride };
  }

  const systemPromptOverride = process.env.TINY_AGENT_SYSTEM_PROMPT;
  if (systemPromptOverride) {
    config = { ...config, systemPrompt: systemPromptOverride };
  }

  const conversationFileOverride = process.env.TINY_AGENT_CONVERSATION_FILE;
  if (conversationFileOverride) {
    config = { ...config, conversationFile: conversationFileOverride };
  }

  const maxContextTokensOverride = process.env.TINY_AGENT_MAX_CONTEXT_TOKENS;
  if (maxContextTokensOverride) {
    const parsed = parseInt(maxContextTokensOverride, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      config = { ...config, maxContextTokens: parsed };
    }
  }

  const memoryFileOverride = process.env.TINY_AGENT_MEMORY_FILE;
  if (memoryFileOverride) {
    config = { ...config, memoryFile: memoryFileOverride };
  }

  const maxMemoryTokensOverride = process.env.TINY_AGENT_MAX_MEMORY_TOKENS;
  if (maxMemoryTokensOverride) {
    const parsed = parseInt(maxMemoryTokensOverride, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      config = { ...config, maxMemoryTokens: parsed };
    }
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
