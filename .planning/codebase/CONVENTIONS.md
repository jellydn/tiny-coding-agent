# Coding Conventions

**Analysis Date:** 2026-01-25

## Languages

**Primary:**

- TypeScript 5+ - All source code and tests
- ES Modules - Native ESM with `.js` extension in imports

**Secondary:**

- JSON - Configuration files
- Markdown - Documentation

## Runtime

**Environment:**

- Node.js 18+ (ES Modules support)
- Bun runtime for development and testing

**Package Manager:**

- Bun (lockfile: `bun.lock`)

## Frameworks

**Core:**

- TypeScript 5.9.3 - Type safety
- Zod 4.x - Runtime validation

**Testing:**

- bun:test - Built-in test runner

**Build/Dev:**

- oxlint 1.39.0 - Linting
- oxfmt 0.26.0 - Formatting
- TypeScript compiler - Type checking

## Key Dependencies

**Critical:**

- `@anthropic-ai/sdk` - Anthropic LLM provider
- `@modelcontextprotocol/sdk` - MCP protocol support
- `openai` - OpenAI LLM provider
- `ollama` - Ollama LLM provider
- `zod` - Schema validation

**Infrastructure:**

- `ink` + `react` - CLI UI components
- `tiktoken` - Token counting

## Configuration

**TypeScript (`tsconfig.json`):**

```json
{
  "compilerOptions": {
    "strict": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "verbatimModuleSyntax": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  }
}
```

**Linting (`.oxlintrc.json`):**

- Uses `oxlint` with plugins: `unicorn`, `typescript`, `oxc`
- Rules enabled as `warn` level

**Formatting (`.oxfmtrc.json`):**

- Uses `oxfmt` with default settings

## Code Style

### Naming Patterns

**Files:**

- `kebab-case.ts` - All source files
- Example: `file-tools.ts`, `bash-tool.ts`, `memory-store.ts`

**Directories:**

- `kebab-case` - All directories
- Example: `core/`, `tools/`, `providers/`

**Classes/Types:**

- `PascalCase` - Classes, interfaces, types, enums
- Example: `Agent`, `MemoryStore`, `ToolResult`

**Functions/Variables:**

- `camelCase` - Functions, variables, object properties
- Example: `runStream()`, `handleFileError()`, `maxIterations`

**Constants:**

- `SCREAMING_SNAKE_CASE` - Constant values
- Example: `MAX_OUTPUT_LENGTH`, `PROVIDER_CACHE_MAX_SIZE`

**Private Members:**

- `_prefix` (underscore) - Private class properties
- Example: `_defaultLlmClient`, `_conversationManager`

### Strings & Variables

```typescript
const message = "text"; // Double quotes for strings
let count = 0; // let only when reassigning
const timeout = args.timeout ?? 60000; // ?? for nullish coalescing defaults
```

### Imports & Path Aliases

**Organization (in order):**

1. Node.js built-ins with `node:` prefix
2. External package imports
3. Path alias imports with `.js` extension for internal modules

```typescript
import * as fs from "node:fs/promises"; // Node built-ins
import OpenAI from "openai"; // External deps
import type { Tool } from "./types.js"; // Internal: .js extension
import { Agent } from "@/core/agent.js"; // Path alias
```

**Path Aliases:**

- `@/*` maps to `src/*`
- Example: `@/tools/registry.js` → `src/tools/registry.js`

### TypeScript Specifics

**Strict Mode Enabled:**

- Full strict type checking
- `verbatimModuleSyntax` - Requires explicit type imports with `import type`
- `noUncheckedIndexedAccess` - Indexed access requires validation
- `noImplicitOverride` - Override methods must use `override` keyword

**Type Narrowing:**

- Use `satisfies` for type narrowing with validation
- Use Zod for runtime validation of external inputs

### Error Handling

**Pattern: Return structured results**

Never throw for expected failures. Return `{ success: boolean; error?: string; output?: string }`:

```typescript
async function readFile(filePath: string): Promise<ToolResult> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return { success: true, output: content };
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      return { success: false, error: `File not found: ${filePath}` };
    }
    if (error.code === "EACCES") {
      return { success: false, error: `Permission denied: ${filePath}` };
    }
    return { success: false, error: error.message };
  }
}
```

**Error Codes:**

- `ENOENT` - File/directory not found
- `EACCES` - Permission denied
- `ENOTDIR` - Path component is not a directory
- `EISDIR` - Is a directory

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

### Guard Clauses

Move preconditions to top, return early:

```typescript
function processFile(filePath: string): Result<void> {
  if (!filePath) return { success: false, error: "File path required" };
  if (isSensitiveFile(filePath)) return { success: false, error: "Cannot process sensitive file" };

  // Main logic
}
```

### Module Design

**Exports:**

- Named exports preferred for internal modules
- Barrel files (`index.ts`) for re-exports from directories

**Pattern:**

```typescript
// src/tools/file-tools.ts
export const readFileTool: Tool = {
  /* ... */
};
export const writeFileTool: Tool = {
  /* ... */
};

// src/tools/index.ts
export { readFileTool, writeFileTool } from "./file-tools.js";
```

### Function Design

**Parameters:**

- Use objects for multiple parameters (options pattern)
- Type validation with Zod schemas for tool arguments

**Return Values:**

- Async generators for streaming (`async *` pattern)
- Structured results for operations

### Comments

**When to Comment:**

- Complex algorithm logic
- Non-obvious workarounds
- TODO/FIXME for technical debt

**JSDoc:**

- Use for public API documentation
- Required for utility functions exported from modules

### Tool Definition Pattern

```typescript
export const readFileTool: Tool = {
  name: "read_file",
  description: "Read file contents...",
  dangerous: (args) => (isSensitiveFile(args.path) ? "Reading sensitive file" : false),
  parameters: {
    type: "object",
    properties: { path: { type: "string", description: "File path" } },
    required: ["path"],
  },
  async execute(args): Promise<ToolResult> {
    // Implementation
  },
};
```

### Class Design

**Private Properties:**

- Use `_` prefix for private class members
- `private` keyword for true encapsulation

**Constructor:**

- Options object pattern for optional parameters
- Default values with nullish coalescing

```typescript
export class Agent {
  private _defaultLlmClient: LLMClient;
  private _toolRegistry: ToolRegistry;
  private _maxIterations: number;
  private _verbose: boolean;

  constructor(llmClient: LLMClient, toolRegistry: ToolRegistry, options: AgentOptions = {}) {
    this._defaultLlmClient = llmClient;
    this._toolRegistry = toolRegistry;
    this._maxIterations = options.maxIterations ?? 20;
    this._verbose = options.verbose ?? false;
  }
}
```

---

_Convention analysis: 2026-01-25_
