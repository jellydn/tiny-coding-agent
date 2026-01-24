# Coding Conventions

**Analysis Date:** 2026-01-25

## Naming Patterns

**Files:**
- kebab-case for all TypeScript files: `file-tools.ts`, `conversation-manager.ts`
- No barrel files (index.ts re-exports not used for organizing)

**Functions:**
- camelCase for all functions: `findRelevant()`, `calculateContextBudget()`
- Private methods use `_` prefix: `_evictIfNeeded()`, `_load()`
- Helper functions are standalone, not method properties

**Variables:**
- camelCase for local variables and constants: `maxIterations`, `conversationTokens`
- `_` prefix for private class properties: `this._memoryStore`, `this._maxIterations`
- SCREAMING_SNAKE_CASE for module-level constants: `const SAVE_DEBOUNCE_MS = 100`

**Types:**
- PascalCase for interfaces and types: `MemoryStoreOptions`, `ContextStats`
- TypeScript `type` aliases use PascalCase: `type MemoryCategory = "user" | "project" | "codebase"`

**Classes:**
- PascalCase for class names: `Agent`, `MemoryStore`, `ToolRegistry`

## Code Style

**Formatting:**
- Tool: oxfmt (configured in `.oxfmtrc.json`)
- Check: `bun run format:check`
- Auto-fix: `bun run format`

**Linting:**
- Tool: oxlint (configured in `.oxlintrc.json`)
- Plugins: `unicorn`, `typescript`, `oxc`
- Run: `bun run lint`
- Auto-fix: `bun run lint:fix`

**TypeScript:**
- Target: ESNext
- Module: NodeNext with `verbatimModuleSyntax`
- Strict mode enabled
- `noUncheckedIndexedAccess: true`
- `noImplicitOverride: true`
- `noUnusedLocals: false` (unused code allowed)
- `noUnusedParameters: false`

**Imports:**
```typescript
import * as fs from "node:fs/promises";  // Node built-ins with node: prefix
import OpenAI from "openai";              // External deps
import type { Tool } from "./types.js";   // Internal: .js extension
import { MemoryStore } from "@/core/memory.ts";  // Path alias with .js extension
```

**Path Aliases:**
- `@/*` maps to `src/*` (configured in `tsconfig.json`)
- Use in imports: `import { Tool } from "@/tools/types.js"`

## Import Organization

**Order:**
1. Type imports (`import type` from relative paths)
2. Type imports from path aliases (`@/*`)
3. Node.js built-ins (`node:fs/promises`, `node:path`)
4. External dependencies (`openai`, `zod`)
5. Relative imports from same package (`./*`, `./**/*.js`)

**Note:** Internal imports use `.js` extension even for `.ts` files due to `verbatimModuleSyntax`.

## Error Handling

**Pattern - Structured Results:**
Return `{ success: boolean; output?: string; error?: string }` instead of throwing for expected failures:

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

**Error Codes Used:**
- `ENOENT` - File/directory not found
- `EACCES` - Permission denied
- `ENOTDIR` - Path component is not a directory
- `EISDIR` - Path is a directory
- `ENOTDIR` - Path component exists but is not a directory

**Helper Functions:**
- `handleFileError()` in `src/tools/file-tools.ts`
- `handleDirError()` in `src/tools/file-tools.ts`

## Logging

**Framework:** `console` (native Node.js)

**Patterns:**
- Debug/verbose logging: `if (this._verbose) { console.log(...) }`
- No structured logging library
- Warnings: `console.warn()` for recoverable issues
- Errors: `console.error()` for failures that don't throw

## Comments

**When to Comment:**
- Complex algorithms or non-obvious logic
- Security considerations
- Workarounds for external library issues
- TODO comments for planned changes

**JSDoc/TSDoc:**
- Not required for all functions
- Used for tool definitions (description, parameters)
- Parameters documented in tool schema objects

**Example from tools:**
```typescript
export const readFileTool: Tool = {
  name: "read_file",
  description: "Read the contents of a file...",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "The absolute or relative path..." },
    },
    required: ["path"],
  },
};
```

## Function Design

**Parameters:**
- Use optional parameters with defaults: `options: AgentOptions = {}`
- Use nullish coalescing for defaults: `options.maxIterations ?? 20`
- Group related options in objects

**Return Values:**
- Public methods return meaningful types
- Private methods use `void` or specific types
- Async functions return `Promise<T>`

**Generator Functions:**
- Use `async *` for streaming responses: `async *runStream(...)`
- Yield chunks of data during iteration

## Module Design

**Exports:**
- Named exports for types, functions, classes
- No default exports
- Examples: `export class Agent`, `export interface ToolResult`

## String Patterns

**Quotes:** Double quotes for all strings
```typescript
const message = "text";
const error = `File not found: ${filePath}`;
```

**Nullish Coalescing:** Use `??` for default values
```typescript
const timeout = args.timeout ?? 60000;
const homeDir = process.env.HOME ?? "";
```

**Variable Declaration:**
- `const` by default
- `let` only when reassigning
- No `var`

## Class Design

**Private Members:**
- Use `_` prefix: `this._memoryStore`, `this._maxIterations`
- Marked with `private` modifier
- Constructor assignment preferred

**Property Initialization:**
- In constructor or inline:
```typescript
class Agent {
  private _maxIterations: number;
  private _verbose: boolean;
  private _memoryStore?: MemoryStore;
  
  constructor(options: AgentOptions = {}) {
    this._maxIterations = options.maxIterations ?? 20;
    this._verbose = options.verbose ?? false;
  }
}
```

**Type Assertions:**
- Use `as` for type casting: `const error = err as NodeJS.ErrnoException`
- Use `satisfies` where type narrowing with validation is needed

---

*Convention analysis: 2026-01-25*
