import type { McpServerConfig } from "../config/schema.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { Tool, ToolResult } from "../tools/types.js";
import { isCommandAvailable } from "../utils/command.js";
import { McpClient } from "./client.js";
import type { McpConnection, McpToolDefinition } from "./types.js";

export function globToRegex(pattern: string): RegExp {
	const escaped = pattern.replace(/[\\[.+?^${}()|]/g, "\\$&").replace(/\*/g, ".*?");
	return new RegExp(`^${escaped}$`);
}

export class McpManager {
	private _clients: Map<string, McpClient> = new Map();
	private _maxRestartAttempts = 3;
	private _disabledPatterns: string[] = [];
	private _verbose: boolean;

	constructor(options: { disabledPatterns?: string[]; verbose?: boolean } = {}) {
		this._disabledPatterns = options.disabledPatterns ?? [];
		this._verbose = options.verbose ?? false;
	}

	setVerbose(verbose: boolean): void {
		this._verbose = verbose;
	}

	private _isDisabledByPattern(name: string): boolean {
		return this._disabledPatterns.some((pattern) => globToRegex(pattern).test(name));
	}

	async addServer(name: string, config: McpServerConfig): Promise<boolean> {
		if (this._clients.has(name)) {
			return false;
		}

		if (!isCommandAvailable(config.command)) {
			if (this._verbose) {
				console.warn(`[MCP] ${name}: command "${config.command}" not found`);
			}
			return false;
		}

		const client = new McpClient(name, config);
		this._clients.set(name, client);

		try {
			await client.connect();
			if (this._verbose) {
				console.warn(`[MCP] Connected ${name} with ${client.tools.length} tools`);
			}
		} catch {
			if (this._verbose) {
				console.warn(`[MCP] ${name}: will connect on first tool use`);
			}
		}
		return true;
	}

	private async _connectClient(name: string, client: McpClient): Promise<void> {
		for (let attempts = 0; attempts < this._maxRestartAttempts; attempts++) {
			try {
				await client.connect();
				if (this._verbose) console.warn(`[MCP] Connected ${name} with ${client.tools.length} tools`);
				return;
			} catch {
				if (attempts < this._maxRestartAttempts - 1) {
					await new Promise((resolve) => setTimeout(resolve, 1000 * (attempts + 1)));
				}
			}
		}
		if (this._verbose) console.warn(`[MCP] ${name} unavailable - will retry on next tool use`);
	}

	async removeServer(name: string): Promise<void> {
		const client = this._clients.get(name);
		if (client) {
			await client.disconnect();
			this._clients.delete(name);
		}
	}

	async restartServer(name: string): Promise<void> {
		const client = this._clients.get(name);
		if (client) {
			await client.disconnect();
			await this._connectClient(name, client);
		}
	}

	getTools(serverName: string): McpToolDefinition[] {
		return this._clients.get(serverName)?.tools ?? [];
	}

	getAllTools(): Map<string, McpToolDefinition[]> {
		return new Map(Array.from(this._clients, ([name, client]) => [name, client.tools]));
	}

	async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
		const client = this._clients.get(serverName);
		if (!client) {
			return { success: false, error: `MCP server "${serverName}" not found` };
		}

		if (!client.isConnected) {
			await this._connectClient(serverName, client);
			if (!client.isConnected) {
				return {
					success: false,
					error: `MCP server "${serverName}" not available. Install required dependencies or disable with './tiny-agent mcp disable ${serverName}'`,
				};
			}
		}

		try {
			const result = await client.callTool(toolName, args);
			const textContent = result.content
				.filter((c) => c.type === "text" && c.text)
				.map((c) => c.text)
				.join("\n");

			if (result.isError) {
				return { success: false, error: textContent || "Tool execution failed" };
			}

			return { success: true, output: textContent };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	getConnections(): McpConnection[] {
		return Array.from(this._clients.values()).map((client) => client.getConnection());
	}

	isServerConnected(name: string): boolean {
		return this._clients.get(name)?.isConnected ?? false;
	}

	getServerStatus(): Array<{ name: string; connected: boolean; toolCount: number }> {
		return Array.from(this._clients.entries()).map(([name, client]) => {
			const toolCount = client.tools.filter(
				(toolDef) => !this._isDisabledByPattern(`mcp_${name}_${toolDef.name}`)
			).length;
			return { name, connected: client.isConnected, toolCount };
		});
	}

	registerToolsWithRegistry(registry: ToolRegistry): void {
		for (const [serverName, client] of this._clients) {
			for (const toolDef of client.tools) {
				const tool = this.createToolFromMcp(serverName, toolDef);
				try {
					registry.register(tool);
				} catch {
					console.warn(`Tool "${tool.name}" from MCP server "${serverName}" conflicts with existing tool`);
				}
			}
		}
	}

	createToolFromMcp(serverName: string, toolDef: McpToolDefinition): Tool {
		const prefixedName = `mcp_${serverName}_${toolDef.name}`;

		return {
			name: prefixedName,
			description: `[MCP: ${serverName}] ${toolDef.description}`,
			dangerous: `MCP server call: ${serverName}`,
			parameters: {
				type: "object",
				properties: toolDef.inputSchema.properties ?? {},
				required: toolDef.inputSchema.required,
			},
			execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
				return this.callTool(serverName, toolDef.name, args);
			},
		};
	}

	async disconnectAll(): Promise<void> {
		await Promise.allSettled(Array.from(this._clients.values()).map((c) => c.disconnect()));
		this._clients.clear();
	}
}
