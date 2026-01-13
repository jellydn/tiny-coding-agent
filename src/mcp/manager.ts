import type { McpServerConfig } from "../config/schema.js";
import type { Tool, ToolResult } from "../tools/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import { McpClient } from "./client.js";
import type { McpToolDefinition, McpConnection } from "./types.js";

export class McpManager {
  private _clients: Map<string, McpClient> = new Map();
  private _restartAttempts: Map<string, number> = new Map();
  private _maxRestartAttempts = 3;

  async addServer(name: string, config: McpServerConfig): Promise<void> {
    if (this._clients.has(name)) {
      throw new Error(`MCP server "${name}" is already registered`);
    }

    const client = new McpClient(name, config);
    this._clients.set(name, client);
    this._restartAttempts.set(name, 0);

    await this._connectClient(name, client);
  }

  private async _connectClient(name: string, client: McpClient): Promise<void> {
    try {
      await client.connect();
      this._restartAttempts.set(name, 0);
    } catch (error) {
      const attempts = this._restartAttempts.get(name) ?? 0;
      if (attempts < this._maxRestartAttempts) {
        this._restartAttempts.set(name, attempts + 1);
        console.error(
          `MCP server "${name}" connection failed (attempt ${attempts + 1}/${this._maxRestartAttempts}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        await this._delay(1000 * (attempts + 1));
        await this._connectClient(name, client);
      } else {
        throw new Error(
          `MCP server "${name}" failed to connect after ${this._maxRestartAttempts} attempts`,
        );
      }
    }
  }

  private _delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async removeServer(name: string): Promise<void> {
    const client = this._clients.get(name);
    if (client) {
      await client.disconnect();
      this._clients.delete(name);
      this._restartAttempts.delete(name);
    }
  }

  async restartServer(name: string): Promise<void> {
    const client = this._clients.get(name);
    if (!client) {
      throw new Error(`MCP server "${name}" not found`);
    }

    await client.disconnect();
    this._restartAttempts.set(name, 0);
    await this._connectClient(name, client);
  }

  getTools(serverName: string): McpToolDefinition[] {
    const client = this._clients.get(serverName);
    return client?.tools ?? [];
  }

  getAllTools(): Map<string, McpToolDefinition[]> {
    const result = new Map<string, McpToolDefinition[]>();
    for (const [name, client] of this._clients) {
      result.set(name, client.tools);
    }
    return result;
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const client = this._clients.get(serverName);
    if (!client) {
      return {
        success: false,
        error: `MCP server "${serverName}" not found`,
      };
    }

    if (!client.isConnected) {
      try {
        await this._connectClient(serverName, client);
      } catch (error) {
        return {
          success: false,
          error: `MCP server "${serverName}" is not connected: ${
            error instanceof Error ? error.message : String(error)
          }`,
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
        return {
          success: false,
          error: textContent || "Tool execution failed",
        };
      }

      return {
        success: true,
        output: textContent,
      };
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

  registerToolsWithRegistry(registry: ToolRegistry): void {
    for (const [serverName, client] of this._clients) {
      for (const toolDef of client.tools) {
        const tool = this._createToolFromMcp(serverName, toolDef);
        try {
          registry.register(tool);
        } catch {
          console.warn(
            `Tool "${tool.name}" from MCP server "${serverName}" conflicts with existing tool`,
          );
        }
      }
    }
  }

  private _createToolFromMcp(serverName: string, toolDef: McpToolDefinition): Tool {
    const prefixedName = `mcp_${serverName}_${toolDef.name}`;

    return {
      name: prefixedName,
      description: `[MCP: ${serverName}] ${toolDef.description}`,
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
    const disconnectPromises = Array.from(this._clients.values()).map((client) =>
      client.disconnect(),
    );
    await Promise.allSettled(disconnectPromises);
    this._clients.clear();
    this._restartAttempts.clear();
  }
}
