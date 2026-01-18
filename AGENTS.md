# Tiny Coding Agent - Development Guide

## Build Commands

```bash
bun run dev              # Watch mode
bun run build            # Compile to binary (outputs tiny-agent)
bun run typecheck        # Type check (tsc --noEmit)
bun run lint             # Lint (oxlint)
bun run lint:fix         # Auto-fix lint issues
bun run format           # Format code (oxfmt)
bun test                 # Run all tests
bun test <file>          # Run single test (e.g., src/core/memory.test.ts)
bun test:watch           # Watch mode for TDD
bun run format && bun run typecheck && bun run lint  # After changes
```

## Code Style

### Imports & Naming

```typescript
import * as fs from "node:fs/promises"; // Node built-ins with node: prefix
import OpenAI from "openai"; // External deps
import type { Tool } from "./types.js"; // Internal: .js extension

// Naming: kebab-case (files), PascalCase (classes/types), camelCase (vars/functions),
// SCREAMING_SNAKE_CASE (constants), _prefix (private members)
```

### TypeScript

- ES modules with TypeScript 5+, strict mode
- Compiler: `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `noImplicitOverride`
- Note: `noUnusedLocals: false`, `noUnusedParameters: false` (unused code allowed)
- Paths: Use `@/*` alias (e.g., `import { Tool } from "@/tools/types.js"`)
- Use `satisfies` for type narrowing with validation

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

- **Guard Clauses**: Move preconditions to top, return early
- **Helper Variables**: Extract complex expressions
- **Dead Code**: Delete unused code
- **Normalize Symmetries**: Use consistent patterns

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

Use bun:test with `describe`, `it`, `expect`. Clean up resources in beforeEach/afterEach:

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

**Write tests that give confidence**: Test behavior, not implementation details.

## Project Structure

```
src/
  core/       # Agent loop, memory, tokens
  tools/      # Built-in tools (file, bash, grep, glob, web)
  providers/  # LLM clients (OpenAI, Anthropic, Ollama)
  mcp/        # MCP client integration
  cli/        # CLI interface
  config/     # Configuration loading
```

Key dependencies: `@anthropic-ai/sdk`, `openai`, `ollama`, `@modelcontextprotocol/sdk`, `zod`.

## CLI Usage

```bash
tiny-agent                         # Interactive chat
tiny-agent run "fix this bug"      # Run single prompt
tiny-agent --model claude-3-5-sonnet "help"  # Specify model
tiny-agent --provider ollama run "help"      # Specify provider
tiny-agent memory list              # List memories
tiny-agent config                   # Show config
tiny-agent status                   # Show capabilities
```

Options: `--model`, `--provider`, `--verbose`, `--save`, `--no-memory`, `--no-track-context`, `--agents-md <path>`, `--help`.

## Core Principles

- **Small, Safe Steps**: Make big changes through small, reversible steps
- **Human Relationships**: Code is communication between humans
- **Eliminate Problems**: Remove complexity rather than managing it
