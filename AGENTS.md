# Tiny Coding Agent - Development Guide

## Build Commands

```bash
bun run dev              # Watch mode
bun run build            # Compile to binary (outputs tiny-agent)
bun run generate:skills  # Regenerate embedded skills
bun run typecheck        # Type check (tsc --noEmit)
bun run lint             # Lint (oxlint)
bun run lint:fix         # Auto-fix lint issues
bun run format           # Format code (oxfmt)
bun run format:check     # Check formatting only
bun test                 # Run all tests
bun test <file>          # Run single test file (e.g., "bun test tools/file.test.ts")
bun test <pattern>       # Run tests matching pattern (e.g., "bun test memory")
bun test:watch           # Watch mode for TDD

# Release workflow (runs test, typecheck, lint first)
bun run release:patch    # Patch release
bun run release:minor    # Minor release
bun run release:major    # Major release
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
- Compiler options in `tsconfig.json`:
  - `verbatimModuleSyntax`: Requires explicit `import type` for types
  - `noUncheckedIndexedAccess`: Accessing indexed types requires validation
  - `noImplicitOverride`: Override methods must use `override` keyword
- Paths: Use `@/*` alias (e.g., `import { Tool } from "@/tools/types.js"`)
- Use `satisfies` for type narrowing with validation
- Use `zod` for runtime validation of inputs and configs

### Strings & Variables

```typescript
const message = "text"; // Double quotes
let count = 0; // let only when reassigning
const timeout = args.timeout ?? 60000; // ?? for nullish coalescing defaults
```

### React & JSX

- Project uses Ink (React for CLI) for UI components
- Use function components with TypeScript interfaces for props
- Avoid class components

```typescript
import React from "react";
import { Box, Text } from "ink";

interface Props {
  message: string;
}

export const Message: React.FC<Props> = ({ message }) => (
  <Box><Text>{message}</Text></Box>
);
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

### Async Patterns

```typescript
async function fetchData(url: string): Promise<Result<Data>> {
  try {
    const response = await fetch(url);
    if (!response.ok) return { success: false, error: `HTTP ${response.status}` };
    return { success: true, data: await response.json() };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
```

### Tidying Practices

- **Guard Clauses**: Move preconditions to top, return early
- **Helper Variables**: Extract complex expressions
- **Dead Code**: Delete unused code
- **Normalize Symmetries**: Use consistent patterns

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
  agents/     # Agent system (plan, build, explore agents, state management)
  core/       # Agent loop, memory, tokens
  tools/      # Built-in tools (file, bash, grep, glob, web)
  providers/  # LLM clients (OpenAI, Anthropic, Ollama, OpenRouter, OpenCode)
  mcp/        # MCP client integration
  cli/        # CLI interface
  config/     # Configuration loading
  skills/     # Skill loading (agentskills.io + custom SKILL.md files)
  ui/         # Ink React components for CLI output
  utils/      # Shared utilities
```

## Agent Workflow

1. **Understand First**: Read relevant files before making changes
2. **Plan First**: Propose a plan before editing, break into manageable steps
3. **Test-Driven**: Run tests after changes to verify correctness
4. **Typecheck & Lint**: Always run `bun run typecheck && bun run lint` after changes

## General Guidelines

- Keep responses concise and actionable
- Never run destructive commands
- Use our conventions for file names, tests, and commands
- Keep code clean and organized; avoid over-engineering
- Write clear, modular code with meaningful names
- Prefer self-documenting code; add comments where necessary
- Avoid tight coupling and excessive dependencies
