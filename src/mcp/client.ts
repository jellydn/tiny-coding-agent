import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpServerConfig } from "../config/schema.js";
import type { McpToolDefinition, McpToolCallResult, McpConnection } from "./types.js";

export class McpClient {
  private _client: Client;
  private _transport: StdioClientTransport | null = null;
  private _name: string;
  private _config: McpServerConfig;
  private _tools: McpToolDefinition[] = [];
  private _connected = false;

  constructor(name: string, config: McpServerConfig) {
    this._name = name;
    this._config = config;
    this._client = new Client({
      name: "tiny-agent",
      version: "0.1.0",
    });
  }

  get name(): string {
    return this._name;
  }

  get isConnected(): boolean {
    return this._connected;
  }

  get tools(): McpToolDefinition[] {
    return this._tools;
  }

  async connect(): Promise<void> {
    if (this._connected) return;

    try {
      this._transport = new StdioClientTransport({
        command: this._config.command,
        args: this._config.args,
        env: {
          ...this._config.env,
          DEBUG: "",
          RUST_LOG: "error",
          LOG_LEVEL: "error",
        },
        stderr: "ignore",
      });

      await this._client.connect(this._transport);
      this._connected = true;
      await this._discoverTools();
    } catch (error) {
      this._connected = false;
      throw new Error(
        `Failed to connect to MCP server "${this._name}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async disconnect(): Promise<void> {
    if (!this._connected) {
      return;
    }

    try {
      await this._client.close();
    } catch {
      // Ignore close errors
    } finally {
      this._connected = false;
      this._tools = [];
      this._transport = null;
    }
  }

  private async _discoverTools(): Promise<void> {
    const response = await this._client.listTools();
    this._tools = response.tools.map((tool) => {
      const schema = tool.inputSchema as Record<string, unknown> | undefined;
      return {
        name: tool.name,
        description: tool.description ?? "",
        inputSchema: {
          type: "object" as const,
          properties: schema?.properties as Record<string, unknown> | undefined,
          required: schema?.required as string[] | undefined,
        },
      };
    });
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    if (!this._connected) {
      throw new Error(`MCP server "${this._name}" is not connected`);
    }

    const result = await this._client.callTool({
      name,
      arguments: args,
    });

    return {
      content: result.content as Array<{ type: string; text?: string }>,
      isError: result.isError as boolean | undefined,
    };
  }

  getConnection(): McpConnection {
    return {
      name: this._name,
      config: this._config,
      tools: this._tools,
      isConnected: this._connected,
    };
  }
}
