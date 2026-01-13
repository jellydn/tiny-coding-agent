# Tiny Coding Agent - Development Guide

## Build Commands

```bash
bun run index.ts           # Run agent
bun run dev               # Watch mode
bun run build             # Compile to binary
bun run typecheck         # Type check
bun run lint              # Lint
bun run lint:fix          # Auto-fix lint issues
bun run format            # Format code
bun run format:check      # Check formatting
```

**IMPORTANT**: After code changes, always run `bun run typecheck && bun run lint`.

## Code Style Guidelines

### TypeScript

- ES modules with TypeScript 5+ and strict mode
- Compiler options: `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`

### Imports

```typescript
import * as fs from "node:fs/promises"; // Node built-ins with node: prefix
import OpenAI from "openai"; // External deps
import type { Tool } from "./types.js"; // Internal: .js extension
import { ToolRegistry } from "./registry.js"; // Order: External → internal
```

### Naming Conventions

- **Files**: kebab-case, PascalCase for classes
- **Variables/functions**: camelCase
- **Constants**: SCREAMING_SNAKE_CASE
- **Classes/Interfaces**: PascalCase
- **Private members**: prefix with `_client`

### Strings

Use double quotes: `"text"` not `'text'`

### Error Handling

Tools must return structured results:

```typescript
interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
}

try {
  await fs.readFile(filePath, "utf-8");
} catch (err) {
  const error = err as NodeJS.ErrnoException;
  if (error.code === "ENOENT") {
    return { success: false, error: `File not found: ${filePath}` };
  }
  return { success: false, error: error.message };
}
```

**Never throw errors for expected failures** - return ToolResult instead.

### Code Structure

- Keep functions small (<50 lines)
- Use guard clauses: check for errors early and return
- Extract complex conditions into well-named variables
- Use Map-based registry pattern: register, unregister, get, list, clear

### Tool Implementation

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}

export const bashTool: Tool = {
  name: "bash",
  description: "Execute a shell command",
  parameters: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const command = args.command as string;
    return { success: true, output: "result" };
  },
};
```

### Type Guards

```typescript
function isTool(obj: unknown): obj is Tool {
  if (!obj || typeof obj !== "object") return false;
  const tool = obj as Record<string, unknown>;
  return (
    typeof tool.name === "string" &&
    typeof tool.description === "string" &&
    typeof tool.execute === "function"
  );
}
```

### File I/O Patterns

```typescript
await fs.readFile(path, "utf-8");
await fs.mkdir(dirPath, { recursive: true });

const stdout: Buffer[] = [];
child.stdout.on("data", (data: Buffer) => stdout.push(data));
const output = Buffer.concat(stdout).toString("utf-8");
```

### Project Structure

```
src/
  core/         # Agent loop, context management
  tools/        # Built-in tools (file, bash, grep, glob, web search)
  providers/    # LLM providers (OpenAI, Anthropic, Ollama)
  mcp/          # MCP client integration
  cli/          # Command-line interface
  config/       # Configuration loading
```

### Dependencies

- `@anthropic-ai/sdk` - Claude provider
- `openai` - OpenAI-compatible APIs (Groq, Together, OpenRouter)
- `ollama` - Local model provider
- `@modelcontextprotocol/sdk` - MCP client
- `yaml` - Config parsing
