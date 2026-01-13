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
bun run test              # Run tests (when implemented)
bun run test <file>       # Run single test file
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
```

### Naming Conventions

- **Files**: kebab-case, PascalCase for classes
- **Variables/functions**: camelCase
- **Constants**: SCREAMING_SNAKE_CASE
- **Classes/Interfaces**: PascalCase
- **Private members**: prefix with `_client`

### Strings & Variables

Use double quotes: `"text"` not `'text'`
Use `const` by default, `let` only when reassigning

### Error Handling

Tools must return structured results:

```typescript
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
    const timeout = (args.timeout as number | undefined) ?? 60000;
    return { success: true, output: "result" };
  },
};
```

**Guidelines**: Clear descriptions, `??` for defaults, specific error codes (ENOENT, EACCES)

### Streaming Patterns

Use `AsyncGenerator<StreamChunk>` for real-time responses:

```typescript
async *runStream(...): AsyncGenerator<StreamChunk, void, unknown> {
  for await (const chunk of this._llmClient.stream(...)) {
    if (chunk.content) yield { content: chunk.content, done: false };
    if (chunk.done) { yield { done: true }; return; }
  }
}

// CLI: print chunks immediately
for await (const chunk of agent.runStream(...)) {
  if (chunk.content) process.stdout.write(chunk.content);
}
```

### Configuration

Env var interpolation: `apiKey: ${OPENAI_API_KEY}`
Override via: `TINY_AGENT_MODEL`, `TINY_AGENT_SYSTEM_PROMPT`, `TINY_AGENT_CONVERSATION_FILE`, `TINY_AGENT_MAX_CONTEXT_TOKENS`

### Testing

```typescript
import { describe, it, expect } from "bun:test";

describe("ToolRegistry", () => {
  it("should register and retrieve tools", () => {
    const registry = new ToolRegistry();
    registry.register(bashTool);
    expect(registry.get("bash")).toBe(bashTool);
  });
});
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
