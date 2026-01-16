export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
}

export interface ThinkingConfig {
  enabled?: boolean;
  effort?: "none" | "low" | "medium" | "high";
  budgetTokens?: number;
}

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface ToolConfig {
  enabled: boolean;
  options?: Record<string, unknown>;
}

export interface Config {
  defaultModel: string;
  systemPrompt?: string;
  conversationFile?: string;
  maxContextTokens?: number;
  memoryFile?: string;
  maxMemoryTokens?: number;
  trackContextUsage?: boolean;
  thinking?: ThinkingConfig;
  providers: {
    openai?: ProviderConfig;
    anthropic?: ProviderConfig;
    ollama?: ProviderConfig;
    openrouter?: ProviderConfig;
    opencode?: ProviderConfig;
  };
  mcpServers?: Record<string, McpServerConfig>;
  tools?: Record<string, ToolConfig>;
}

export interface ConfigValidationError {
  field: string;
  message: string;
}

export function validateConfig(config: unknown): ConfigValidationError[] {
  const errors: ConfigValidationError[] = [];

  if (!config || typeof config !== "object") {
    errors.push({ field: "root", message: "Config must be an object" });
    return errors;
  }

  const c = config as Record<string, unknown>;

  if (typeof c.defaultModel !== "string" || c.defaultModel.trim() === "") {
    errors.push({
      field: "defaultModel",
      message: "defaultModel is required and must be a non-empty string",
    });
  }

  if (c.providers !== undefined) {
    if (typeof c.providers !== "object" || c.providers === null) {
      errors.push({
        field: "providers",
        message: "providers must be an object",
      });
    } else {
      const providers = c.providers as Record<string, unknown>;
      for (const [name, provider] of Object.entries(providers)) {
        if (provider !== undefined && typeof provider !== "object") {
          errors.push({
            field: `providers.${name}`,
            message: `Provider ${name} must be an object`,
          });
        }
      }
    }
  }

  if (c.mcpServers !== undefined) {
    if (typeof c.mcpServers !== "object" || c.mcpServers === null) {
      errors.push({
        field: "mcpServers",
        message: "mcpServers must be an object",
      });
    } else {
      const servers = c.mcpServers as Record<string, unknown>;
      for (const [name, server] of Object.entries(servers)) {
        if (typeof server !== "object" || server === null) {
          errors.push({
            field: `mcpServers.${name}`,
            message: `MCP server ${name} must be an object`,
          });
        } else {
          const s = server as Record<string, unknown>;
          if (typeof s.command !== "string") {
            errors.push({
              field: `mcpServers.${name}.command`,
              message: `MCP server ${name} requires a command string`,
            });
          }
        }
      }
    }
  }

  return errors;
}
