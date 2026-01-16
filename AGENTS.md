# Tiny Coding Agent - Development Guide

## Build Commands

```bash
bun run dev                    # Watch mode
bun run build                  # Compile to binary (outputs tiny-agent)
bun run typecheck              # Type check (tsc --noEmit)
bun run lint                   # Lint (oxlint)
bun run lint:fix               # Auto-fix lint issues
bun run format                 # Format code (oxfmt)
bun run format:check           # Check formatting
bun test                       # Run all tests
bun test <file>                # Run single test (e.g., src/core/memory.test.ts)
bun test:watch                 # Watch mode for TDD
```

**After changes**: `bun run format && bun run typecheck && bun run lint`

## Core Principles

- **Small, Safe Steps**: Make big changes through small, reversible steps
- **Human Relationships**: Code is communication between humans
- **Eliminate Problems**: Remove complexity rather than managing it

## TypeScript Guidelines

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

Use specific error codes: `ENOENT`, `EACCES`, `EISDIR`, `ENOTDIR`.

### Tidying Practices

- **Guard Clauses**: Move preconditions to the top and return early
- **Helper Variables**: Extract complex expressions into named variables
- **Dead Code**: Delete code that isn't executed
- **Normalize Symmetries**: Use consistent patterns throughout

### Code Structure

- Keep functions small (<50 lines), use guard clauses
- Extract complex conditions into named variables
- Classes use `_` prefix for private fields
- Use `satisfies` for type narrowing with validation

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

Use bun:test with `describe`, `it`, `expect`. Clean up resources with `beforeEach`/`afterEach`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";

describe("MemoryStore", () => {
  const tempFile = "/tmp/test-memory.json";

  beforeEach(() => {
    try {
      unlinkSync(tempFile);
    } catch {
      /* ignore */
    }
  });

  afterEach(() => {
    try {
      unlinkSync(tempFile);
    } catch {
      /* ignore */
    }
  });

  it("should evict oldest memories when over max limit", () => {
    const store = new MemoryStore({ filePath: tempFile, maxMemories: 3 });
    store.add("1");
    store.add("2");
    store.add("3");
    store.add("4");
    expect(store.count()).toBe(3);
  });
});
```

**Write Tests That Give Confidence**: Test behavior, not implementation details; focus on user-facing functionality.

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

## CLI Usage

```bash
tiny-agent                         # Interactive chat
tiny-agent run "fix this bug"      # Run single prompt
tiny-agent --model claude-3-5-sonnet "help"  # Specify model
tiny-agent --provider ollama run "help"      # Specify provider
tiny-agent --no-memory run "help"   # Disable memory
tiny-agent memory list              # List memories
tiny-agent memory add "I prefer TS" # Add memory
tiny-agent config                   # Show config
tiny-agent status                   # Show capabilities
```

Options: `--model`, `--provider`, `--verbose`, `--save`, `--no-memory`, `--no-track-context`, `--agents-md <path>`, `--help`.

## Dependencies

- `@anthropic-ai/sdk` - Claude provider
- `openai` - OpenAI-compatible APIs
- `ollama` - Local model provider
- `@modelcontextprotocol/sdk` - MCP client
- `yaml` - Config parsing
- `zod` - Runtime validation
