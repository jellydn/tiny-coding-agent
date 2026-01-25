import { z } from "zod";

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

export const providerConfigSchema = z.object({
	apiKey: z.string().optional(),
	baseUrl: z.string().optional(),
});

export const thinkingConfigSchema = z.object({
	enabled: z.boolean().optional(),
	effort: z.enum(["none", "low", "medium", "high"]).optional(),
	budgetTokens: z.number().optional(),
});

export const mcpServerSchema = z.object({
	command: z.string(),
	args: z.array(z.string()).optional(),
	env: z.object({}).optional(),
});

export const toolConfigSchema = z.object({
	enabled: z.boolean(),
	options: z.object({}).optional(),
});

export interface Config {
	defaultModel: string;
	systemPrompt?: string;
	conversationFile?: string;
	maxContextTokens?: number;
	memoryFile?: string;
	maxMemoryTokens?: number;
	trackContextUsage?: boolean;
	skillDirectories?: string[];
	thinking?: ThinkingConfig;
	providers: {
		openai?: ProviderConfig;
		anthropic?: ProviderConfig;
		ollama?: ProviderConfig;
		ollamaCloud?: ProviderConfig;
		openrouter?: ProviderConfig;
		opencode?: ProviderConfig;
		zai?: ProviderConfig;
	};
	mcpServers?: Record<string, McpServerConfig>;
	tools?: Record<string, ToolConfig>;
	disabledMcpPatterns?: string[];
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

	if (c.maxContextTokens !== undefined && (typeof c.maxContextTokens !== "number" || c.maxContextTokens <= 0)) {
		errors.push({
			field: "maxContextTokens",
			message: "maxContextTokens must be a positive number",
		});
	}

	if (c.maxMemoryTokens !== undefined && (typeof c.maxMemoryTokens !== "number" || c.maxMemoryTokens <= 0)) {
		errors.push({
			field: "maxMemoryTokens",
			message: "maxMemoryTokens must be a positive number",
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

	if (c.skillDirectories !== undefined) {
		if (!Array.isArray(c.skillDirectories)) {
			errors.push({
				field: "skillDirectories",
				message: "skillDirectories must be an array",
			});
		} else {
			for (let i = 0; i < c.skillDirectories.length; i++) {
				if (typeof c.skillDirectories[i] !== "string") {
					errors.push({
						field: `skillDirectories[${i}]`,
						message: `skillDirectories[${i}] must be a string`,
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

	if (c.disabledMcpPatterns !== undefined) {
		if (!Array.isArray(c.disabledMcpPatterns)) {
			errors.push({
				field: "disabledMcpPatterns",
				message: "disabledMcpPatterns must be an array",
			});
		} else {
			for (let i = 0; i < c.disabledMcpPatterns.length; i++) {
				if (typeof c.disabledMcpPatterns[i] !== "string") {
					errors.push({
						field: `disabledMcpPatterns[${i}]`,
						message: `disabledMcpPatterns[${i}] must be a string`,
					});
				}
			}
		}
	}

	return errors;
}
