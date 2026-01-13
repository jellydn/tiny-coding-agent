# ADR-003: MCP Client Implementation

**Status:** Accepted  
**Date:** 2026-01-13  
**Deciders:** huynhdung

## Context

The agent needs to connect to external MCP (Model Context Protocol) servers to extend its capabilities with additional tools.

## Decision

### Transport: stdio First

- Start with stdio transport (spawn child process)
- SSE transport deferred to future version

### Implementation Approach

Use the official `@modelcontextprotocol/sdk` package or implement minimal client:

```typescript
interface MCPClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): Promise<MCPTool[]>;
  callTool(name: string, args: unknown): Promise<MCPToolResult>;
}
```

### Server Configuration

```yaml
mcpServers:
  - name: filesystem
    command: npx
    args: ["-y", "@anthropic/mcp-server-filesystem", "/path"]
    env:
      SOME_VAR: value
```

### Tool Integration

- On startup, connect to all configured MCP servers
- Fetch tools via `tools/list` request
- Merge MCP tools into the agent's tool registry
- Namespace MCP tools as `mcp__{serverName}__{toolName}` to avoid conflicts

## Consequences

**Positive:**

- Leverage existing MCP ecosystem
- Standard protocol ensures compatibility
- Modular tool extension without code changes

**Negative:**

- External process management adds complexity
- MCP server failures need graceful handling
- stdio only limits to local servers (SSE needed for remote)
