# ADR-005: Tool System Design

**Status:** Accepted  
**Date:** 2026-01-13  
**Deciders:** huynhdung

## Context

The agent needs a consistent way to define, register, and execute tools. Tools come from three sources: built-in, MCP servers, and plugins.

## Decision

### Tool Interface

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

interface ToolContext {
  workingDirectory: string;
  config: AgentConfig;
  abortSignal?: AbortSignal;
}

interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}
```

### Tool Registry

```typescript
class ToolRegistry {
  register(tool: Tool): void;
  unregister(name: string): void;
  get(name: string): Tool | undefined;
  list(): Tool[];
  toFunctionSchema(): FunctionSchema[]; // For LLM
}
```

### Built-in Tools (v1)

| Tool             | Description             |
| ---------------- | ----------------------- |
| `read_file`      | Read file content       |
| `write_file`     | Write/create file       |
| `edit_file`      | Search/replace in file  |
| `list_directory` | List directory contents |
| `bash`           | Execute shell command   |
| `grep`           | Search file contents    |
| `glob`           | Find files by pattern   |
| `web_search`     | Search the web          |

### Plugin Tools

Loaded from `~/.tiny-agent/plugins/`:

```typescript
// plugin exports
export default tool;           // single tool
export default [tool1, tool2]; // multiple tools
export const tools = [...];    // named export
```

## Consequences

**Positive:**

- Unified interface for all tool sources
- Easy to test tools in isolation
- Clean separation from LLM-specific formats

**Negative:**

- Schema validation adds overhead
- Plugin loading needs careful error handling
