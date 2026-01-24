import { execSync } from "node:child_process";
import type { McpServerConfig } from "../config/schema.js";
import type { Tool, ToolResult } from "../tools/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import { McpClient } from "./client.js";
import type { McpToolDefinition, McpConnection } from "./types.js";

let _verbose = false;

export function setMcpVerbose(verbose: boolean): void {
  _verbose = verbose;
}

function isCommandAvailable(command: string): boolean {
  try {
    execSync(`command -v ${JSON.stringify(command)}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

let _globalMcpManager: McpManager | null = null;

export function setGlobalMcpManager(manager: McpManager | null): void {
  _globalMcpManager = manager;
}

export function getGlobalMcpManager(): McpManager | null {
  return _globalMcpManager;
}

export class McpManager {
  private _clients: Map<string, McpClient> = new Map();
  private _restartAttempts: Map<string, number> = new Map();
  private _maxRestartAttempts = 3;
  private _disabledPatterns: string[] = [];

  constructor(disabledPatterns: string[] = []) {
    setGlobalMcpManager(this);
    this._disabledPatterns = disabledPatterns;
  }

  private _globToRegex(pattern: string): RegExp {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*?");
    return new RegExp(`^${escaped}$`);
  }

  private _isDisabledByPattern(name: string): boolean {
    if (this._disabledPatterns.length === 0 || !name.startsWith("mcp_")) return false;
    return this._disabledPatterns.some((pattern) => this._globToRegex(pattern).test(name));
  }

  async addServer(name: string, config: McpServerConfig): Promise<boolean> {
    if (this._clients.has(name)) {
      return false;
    }

    const client = new McpClient(name, config);
    this._clients.set(name, client);
    this._restartAttempts.set(name, 0);

    if (!isCommandAvailable(config.command)) {
      if (_verbose) {
        console.warn(
          `[MCP] Command "${config.command}" not found for server "${name}". ` +
            `Install the required dependency to enable this MCP server.`,
        );
      }
      return false;
    }

    try {
      await client.connect();
      this._restartAttempts.set(name, 0);
      if (_verbose) {
        process.stderr.write(`[MCP] Connected ${name} with ${client.tools.length} tools\n`);
      }
    } catch {
      if (_verbose) {
        process.stderr.write(`[MCP] ${name}: will connect on first tool use\n`);
      }
    }
    return true;
  }

  private async _connectClient(name: string, client: McpClient): Promise<void> {
    const maxAttempts = this._maxRestartAttempts;
    const attempts = this._restartAttempts.get(name) ?? 0;

    if (attempts >= maxAttempts) {
      if (_verbose) {
        process.stderr.write(`[MCP] ${name} unavailable - will retry on next tool use\n`);
      }
      return;
    }

    try {
      await client.connect();
      this._restartAttempts.set(name, 0);
      if (_verbose) {
        process.stderr.write(`[MCP] Connected ${name} with ${client.tools.length} tools\n`);
      }
      return;
    } catch {
      this._restartAttempts.set(name, attempts + 1);
      if (_verbose) {
        process.stderr.write(
          `[MCP] ${name} connection failed (attempt ${attempts + 1}/${maxAttempts}), retrying...\n`,
        );
      }
    }

    await this._delay(1000 * (attempts + 1));
    await this._connectClient(name, client);
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
      return;
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

  getServerStatus(): Array<{ name: string; connected: boolean; toolCount: number }> {
    return Array.from(this._clients.entries()).map(([name, client]) => {
      const enabledTools = client.tools.filter((toolDef) => {
        const prefixedName = `mcp_${name}_${toolDef.name}`;
        return !this._isDisabledByPattern(prefixedName);
      });
      return {
        name,
        connected: client.isConnected,
        toolCount: enabledTools.length,
      };
    });
  }

  registerToolsWithRegistry(registry: ToolRegistry): void {
    for (const [serverName, client] of this._clients) {
      for (const toolDef of client.tools) {
        const tool = this.createToolFromMcp(serverName, toolDef);
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
    const disconnectPromises = Array.from(this._clients.values()).map((client) =>
      client.disconnect(),
    );
    await Promise.allSettled(disconnectPromises);
    this._clients.clear();
    this._restartAttempts.clear();
  }
}
