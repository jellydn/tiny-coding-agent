# Tiny Coding Agent - Development Guide

## Build Commands

```bash
bun run index.ts <command>     # Run agent (chat, run, memory, config, status)
bun run dev                    # Watch mode
bun run build                  # Compile to binary (outputs tiny-agent)
bun run typecheck              # Type check (tsc --noEmit)
bun run lint                   # Lint (oxlint)
bun run lint:fix               # Auto-fix lint issues
bun run format                 # Format code (oxfmt)
bun run format:check           # Check formatting
bun test                       # Run tests (bun test)
bun test <file>                # Run single test file
```

**After code changes, always run**: `bun run format && bun run typecheck && bun run lint`

## Code Style Guidelines

### TypeScript

- ES modules with TypeScript 5+ and strict mode
- Compiler options: `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`
- Use `.js` extension for internal imports
- Paths: Use `@/*` alias (e.g., `import { Tool } from "@/tools/types.js"`)

### Imports (order matters)

```typescript
import * as fs from "node:fs/promises"; // Node built-ins with node: prefix
import OpenAI from "openai"; // External deps
import type { Tool } from "./types.js"; // Internal: .js extension
```

### Naming Conventions

| Style                  | Usage                                 |
| ---------------------- | ------------------------------------- |
| `kebab-case`           | Files                                 |
| `PascalCase`           | Classes, interfaces, types            |
| `camelCase`            | Variables, functions                  |
| `SCREAMING_SNAKE_CASE` | Constants                             |
| `_prefix`              | Private members (`_client`, `_tools`) |

### Strings & Variables

```typescript
const message = "text"; // Double quotes
let count = 0; // let only when reassigning
const timeout = args.timeout ?? 60000; // ?? for defaults
```

### Error Handling

Return structured results, never throw for expected failures:

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

Use specific error codes: `ENOENT`, `EACCES`, `EISDIR`.

### Code Structure

- Keep functions small (<50 lines), use guard clauses
- Extract complex conditions into named variables
- Classes use `_` prefix for private fields

### Registry Pattern

Use Map with CRUD: `register`, `unregister`, `get`, `list`, `clear`.

### Tool Pattern

```typescript
export const tool: Tool = {
  name: "name",
  description: "Does X",
  parameters: { type: "object", properties: {...}, required: ["arg"] },
  async execute(args) { return { success: true, output: "..." }; },
};
```

## Testing

Use bun:test with `describe`, `it`, `expect`:

```typescript
import { describe, it, expect } from "bun:test";

describe("ToolRegistry", () => {
  it("should register and retrieve tools", () => {
    const registry = new ToolRegistry();
    expect(registry.get("bash")).toBeDefined();
  });
});
```

## Project Structure

```
src/
  core/         # Agent loop, memory, tokens
  tools/        # Built-in tools (file, bash, grep, glob, web)
  providers/    # LLM clients (OpenAI, Anthropic, Ollama)
  mcp/          # MCP client integration
  cli/          # CLI interface
  config/       # Configuration loading
```

## Memory System

Memory and context tracking are enabled by default. Use `--no-memory` or `--no-track-context` to disable.

```bash
tiny-agent run "help me"                   # Memory and context tracking enabled
tiny-agent --no-memory run "help me"       # Run without memory
tiny-agent --no-track-context run "help"  # Run without context tracking
tiny-agent memory list                     # List memories
tiny-agent memory add "I prefer TypeScript" # Add memory
tiny-agent memory clear                    # Clear all memories
```

Context tracking: `total/max tokens - system: X, memory: Y, conversation: Z`

## Configuration

Env vars: `TINY_AGENT_MODEL`, `TINY_AGENT_SYSTEM_PROMPT`, `TINY_AGENT_CONVERSATION_FILE`, `TINY_AGENT_MAX_CONTEXT_TOKENS`, `TINY_AGENT_MEMORY_FILE`, `TINY_AGENT_MAX_MEMORY_TOKENS`.

## AGENTS.md Support

Tiny agent can read and follow AGENTS.md files from other projects:

```bash
tiny-agent run "fix this bug"                    # Auto-detects AGENTS.md in cwd
tiny-agent --agents-md ./path/to/AGENTS.md run "help me"  # Explicit path
```

## Dependencies

- `@anthropic-ai/sdk` - Claude provider
- `openai` - OpenAI-compatible APIs
- `ollama` - Local model provider
- `@modelcontextprotocol/sdk` - MCP client
- `yaml` - Config parsing
- `zod` - Runtime validation
