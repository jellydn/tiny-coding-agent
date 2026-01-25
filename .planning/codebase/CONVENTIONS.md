# Coding Conventions

**Analysis Date:** 2026-01-25

## Naming Patterns

**Files:**
- kebab-case for all files: `file-tools.ts`, `memory-store.ts`, `agent-loop.ts`
- `.test.ts` suffix for test files: `agent.test.ts`, `memory.test.ts`
- `.d.ts` for type declarations if needed

**Classes and Types:**
- PascalCase: `class MemoryStore`, `interface ToolOptions`, `type MemoryCategory`
- Interface naming: `Tool`, `ChatOptions`, `StreamChunk` (no "I" prefix)

**Functions and Variables:**
- camelCase: `findRelevant()`, `getCapabilities()`, `maxMemories`
- Private members: leading underscore `_memories`, `_filePath`
- Constants: SCREAMING_SNAKE_CASE: `SAVE_DEBOUNCE_MS`, `CATEGORY_MULTIPLIERS`

## Code Style

**Formatting:**
- oxfmt is the primary formatter (default config in `.oxfmtrc.json`)
- Run `bun run format` to format code
- Run `bun run format:check` to check formatting only

**Linting:**
- oxlint is the linter with plugins: `unicorn`, `typescript`, `oxc`
- Configured in `.oxlintrc.json` with extensive rule set
- Run `bun run lint` to lint
- Run `bun run lint:fix` to auto-fix issues

**Key linting rules enforced:**
- `no-unused-vars`: unused variables flagged
- `typescript/no-floating-promises`: floating promises must be awaited or explicitly discarded
- `unicorn/prefer-string-starts-ends-with`: use startsWith/endsWith over regex
- `oxc/bad-comparison-sequence`: catches `x === y === z` patterns

## Import Organization

**Order:**
1. Node.js built-ins with `node:` prefix: `import * as fs from "node:fs/promises"`
2. External dependencies: `import OpenAI from "openai"`
3. Internal imports with `.js` extension: `import type { Tool } from "./types.js"`

**Path Aliases:**
- `@/*` alias configured in `tsconfig.json` for `src/*`
- Example: `import { Agent } from "@/core/agent.js"`
- Internal type imports use `import type`: `import type { LLMClient } from "@/providers/types.js"`

## TypeScript Strictness

**Compiler Options in `tsconfig.json`:**
- `verbatimModuleSyntax`: Requires explicit `import type` for types only
- `noUncheckedIndexedAccess`: Indexed access types require validation checks
- `noImplicitOverride`: Override methods must use `override` keyword
- `strict`: All strict checks enabled
- `noUnusedLocals`: false (not enforced)
- `noUnusedParameters`: false (not enforced)

**Type Practices:**
- Use `satisfies` for type narrowing with validation: `const config = settings satisfies Config`
- Zod for runtime validation of inputs and configs: `const schema = z.object({...})`

## Error Handling

**Structured Result Pattern:**
Return objects with `success` boolean, not thrown exceptions:

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

**Error Codes:**
- `ENOENT`: File/directory not found
- `EACCES`: Permission denied
- `EISDIR`: Is a directory (not a file)
- `ENOTDIR`: Not a directory

**Tool Execution Results:**
- Always return `{ success: boolean; output?: string; error?: string }`
- Tool registry wraps execution to provide consistent error format

## Logging

**Framework:** `console` (no external logging library)

**Patterns:**
- Use `[ClassName]` prefix for log messages: `console.error(\`[MemoryStore] Failed to load memories: ${err}\`)`
- Error logging with `console.error`
- Debug/info logging with `console.log` or `console.info` as needed

**JSDoc Comments:**
Use for public methods and complex logic:

```typescript
/**
 * Mark all memories as accessed (updates lastAccessedAt and increments accessCount)
 */
touchAll(): void {
```

## Function Design

**Parameters:**
- Optional parameters with `= {}` or `??` defaults
- Type all parameters explicitly

**Return Values:**
- Promise<T> for async functions
- Structured objects for complex returns: `{ context: Message[]; stats: ContextStats }`

**Guard Clauses:**
Move preconditions to top, return early:

```typescript
if (!this._filePath) {
  return;
}
```

## React & Ink (CLI UI)

**Component Style:**
- Function components with TypeScript interfaces for props
- Import React types: `import type { FC } from "react"` or use `React.FC<Props>`
- Ink components: `import { Box, Text } from "ink"`

```typescript
interface Props {
  message: string;
}

export const Message: React.FC<Props> = ({ message }) => (
  <Box><Text>{message}</Text></Box>
);
```

## Async Patterns

**Promise Handling:**
- Use `async/await` consistently
- Handle promise rejection with try/catch returning structured results
- Explicit `void` for discarded promises: `void this._save()`

**Nullish Coalescing:**
Use `??` for nullish defaults: `const timeout = args.timeout ?? 60000`

## Strings

**Quotes:**
- Double quotes for strings: `const message = "text"`
- Template literals for interpolation: `` `File not found: ${filePath}` ``

---

*Convention analysis: 2026-01-25*
