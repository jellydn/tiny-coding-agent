# Coding Conventions

## Imports & Naming

```typescript
import * as fs from "node:fs/promises"; // Node builtins with node: prefix
import OpenAI from "openai"; // External deps
import type { Tool } from "./types.js"; // Internal: .js extension, type-only with `import type`
import { ToolRegistry } from "@/tools/registry.js"; // Path alias @/* → ./src/*
```

### Naming Rules

| Category | Convention | Example |
|----------|-----------|---------|
| Files | kebab-case | `file-tools.ts`, `agent-observability.ts` |
| Classes/Types/Interfaces | PascalCase | `ToolRegistry`, `StateManager`, `LLMClient` |
| Functions/Variables | camelCase | `loadConfig`, `createProvider` |
| Constants | SCREAMING_SNAKE_CASE | `DEFAULT_STATE_FILE`, `MAX_STATE_FILE_SIZE` |
| Private members | `_prefix` | `_providerCache`, `_toolRegistry` |
| Enum values | PascalCase | `MessageRole.ASSISTANT`, `StatusType.READY` |

### TypeScript Rules (enforced by tsconfig)

- `strict: true` — strict mode
- `verbatimModuleSyntax` — requires explicit `import type` for types
- `noUncheckedIndexedAccess` — accessing indexed types requires validation
- `noImplicitOverride` — override methods must use `override` keyword
- `let` only when reassigning; `const` by default
- `??` for nullish coalescing defaults (not `||`)

## Strings & Quotes

```typescript
const message = "text"; // Double quotes (enforced by Biome)
const timeout = args.timeout ?? 60000; // ?? for nullish defaults
```

## Error Handling

Return structured results, never throw for expected failures:

```typescript
// ✅ Correct — structured result
async function fetchData(url: string): Promise<Result<Data>> {
  try {
    const response = await fetch(url);
    if (!response.ok) return { success: false, error: `HTTP ${response.status}` };
    return { success: true, data: await response.json() };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ❌ Wrong — throwing for expected failure
async function fetchData(url: string): Promise<Data> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
```

### Error Codes

Use specific `NodeJS.ErrnoException` codes: `ENOENT`, `EACCES`, `EISDIR`, `ENOTDIR`.

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

## React & JSX (Ink CLI)

The project uses Ink (React for CLI) for terminal UI components.

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

- Function components with TypeScript interfaces for props
- No class components
- Hooks: `useCallback`, `useContext`, `useState`
- Context providers: `ChatContext`, `StatusLineContext`, `ToastContext`

## Async Patterns

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

### Async Generators (Streaming)

The agent loop uses `while(true) + gen.next()` (not `for-await`) to access the generator's return value:

```typescript
const streamGen = streamLlmResponse({ ... });
while (true) {
  const { value, done } = await streamGen.next();
  if (done) {
    const result = value as StreamLlmResult;
    break;
  }
  // value is a content string
  yield { content: value, ... };
}
```

## Validation (Zod)

Runtime validation for configs and tool inputs:

```typescript
import { z } from "zod";

export const providerConfigSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
});

export const configSchema = z.object({
  defaultModel: z.string(),
  providers: z.record(z.string(), providerConfigSchema).optional(),
  // ...
});
```

- Use `satisfies` for type narrowing with validation
- Config validated on load via `validateConfig()`

## Module Decomposition Pattern (ADR-016)

When extracting modules from a monolith:

1. **Deletion test** — would deleting the module concentrate complexity, or just move it?
2. **Type-only imports** — use `import type` to break circular dependencies
3. **Re-exports** for backward compatibility — `export { X } from "./new-module.js"`
4. **No-op pattern** for optional features — `DebugLogger`/`AgentObservability` have zero overhead when disabled

```typescript
// Re-export for backward compatibility
export { isLooping, streamLlmResponse } from "./agent-utils.js";
export type { ProviderConfigs } from "./provider-cache.js";
```

## Tidying Practices

- **Guard Clauses**: Move preconditions to top, return early
- **Helper Variables**: Extract complex expressions
- **Dead Code**: Delete unused code
- **Normalize Symmetries**: Use consistent patterns across similar modules

## Linting & Formatting (Biome)

| Setting | Value |
|---------|-------|
| Indentation | Tabs (width 2) |
| Line width | 120 characters |
| Quotes | Double |
| Semicolons | Enabled |
| Trailing commas | ES5 |
| Import organization | Automatic |

### Disabled Rules

- `noNonNullAssertion` — non-null assertions (`!`) allowed
- `noNonNullAssertedOptionalChain` — `?.` + `!` allowed
- `noArrayIndexKey` — array index as key allowed
- `noAssignInExpressions` — assignment in expressions allowed

## Git Conventions

### Commit Messages (Commitizen)

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`, `build`, `revert`

### Pre-commit Hooks (Husky)

- Runs `bun run lint` and `bun run format` before commit
- Version generation + embedded skills regeneration on commit

## Configuration File Format

```yaml
# ~/.tiny-agent/config.yaml
defaultModel: openai/gpt-4o
providers:
  openai:
    apiKey: ${OPENAI_API_KEY}  # env-var reference (recommended)
  ollama:
    baseUrl: http://localhost:11434
memoryFile: ~/.tiny-agent/memories.json
maxContextTokens: 32000
hooks:
  - name: plannotator-review
    event: post-plan-generate
    command: plannotator
    args: ["--review"]
    inputMode: stdin
    enabled: true
```
