import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { Config } from "./schema.js";
import { validateConfig } from "./schema.js";

const CONFIG_DIR = join(homedir(), ".tiny-agent");
const YAML_PATH = join(CONFIG_DIR, "config.yaml");
const JSON_PATH = join(CONFIG_DIR, "config.json");

function getDefaultConfig(): Config {
  return {
    defaultModel: "llama3.2",
    systemPrompt: "You are a helpful coding assistant. Be concise.",
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
    if (!isNaN(parsed) && parsed > 0) {
      config = { ...config, maxContextTokens: parsed };
    }
  }

  return config;
}
