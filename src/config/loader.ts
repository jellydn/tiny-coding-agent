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
      serena: {
        command: "uvx",
        args: [
          "--from",
          "git+https://github.com/oraios/serena",
          "serena",
          "start-mcp-server",
          "--context",
          "ide",
          "--project",
          ".",
        ],
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
    if (!envValue) {
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
  let rawConfig: unknown;
  let configSource = "default config";

  if (existsSync(YAML_PATH)) {
    configSource = YAML_PATH;
    const content = readFileSync(YAML_PATH, "utf-8");
    rawConfig = parseYaml(content);
  } else if (existsSync(JSON_PATH)) {
    configSource = JSON_PATH;
    const content = readFileSync(JSON_PATH, "utf-8");
    rawConfig = JSON.parse(content);
  } else {
    createDefaultConfig();
    const content = readFileSync(YAML_PATH, "utf-8");
    rawConfig = parseYaml(content);
  }

  const interpolatedConfig = interpolateObject(rawConfig);

  const errors = validateConfig(interpolatedConfig);
  if (errors.length > 0) {
    const errorMessages = errors.map((e) => `  - ${e.field}: ${e.message}`).join("\n");
    throw new Error(`Invalid config at ${configSource}:\n${errorMessages}`);
  }

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
      dir.startsWith("~/") ? join(homedir(), dir.slice(2)) : dir,
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
