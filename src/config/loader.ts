import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Config } from "./schema.js";
import { validateConfig } from "./schema.js";

const CONFIG_DIR = join(homedir(), ".tiny-agent");
const YAML_PATH = join(CONFIG_DIR, "config.yaml");
const JSON_PATH = join(CONFIG_DIR, "config.json");

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
    throw new Error(`Config file not found. Create ${YAML_PATH} or ${JSON_PATH}`);
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
