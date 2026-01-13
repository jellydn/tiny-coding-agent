import type { McpServerConfig } from "../config/schema.js";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface McpToolCallResult {
  content: Array<{
    type: string;
    text?: string;
  }>;
  isError?: boolean;
}

export interface McpConnection {
  name: string;
  config: McpServerConfig;
  tools: McpToolDefinition[];
  isConnected: boolean;
}
