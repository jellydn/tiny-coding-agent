# Coding Conventions

## Imports & Naming
- **Node built-ins**: `import * as fs from "node:fs/promises"` (with `node:` prefix)
- **External deps**: `import OpenAI from "openai"`
- **Internal modules**: `import type { Tool } from "./types.js"` (with `.js` extension)
- **Type-only imports**: Use `import type { ... }` explicitly (required by `verbatimModuleSyntax`)
- **Files**: kebab-case (`file-tools.ts`, `signal-handler-manager.ts`)
- **Types/Classes**: PascalCase (`MemoryStore`, `ToolRegistry`, `BuildStep`)
- **Variables/Functions**: camelCase (`getStatusIcon`, `parsePlanToSteps`)
- **Constants**: SCREAMING_SNAKE_CASE (`SAVE_DEBOUNCE_MS`, `STATUS_ICON_MAP`)
- **Private members**: `_prefix` (`_memories`, `_saveTimeout`)

## Strings & Values
- **Double quotes** for strings (`"text"`)
- **`let`** only when reassigning; prefer `const`
- **`??`** for nullish coalescing defaults (`options.timeout ?? 60000`)

## React / Ink
- Function components with TypeScript interfaces for props
- `memo` for performance-sensitive components
- Avoid class components
- Prefer hooks for stateful logic

## Error Handling
- Return structured results, never throw for expected failures:
  ```typescript
  return { success: false, error: `File not found: ${filePath}` };
  ```
- Use specific error codes: `ENOENT`, `EACCES`, `EISDIR`, `ENOTDIR`

## Async Patterns
- Use `async/await` throughout
- Prefer `Promise.all` for concurrent operations
- Generator-based streaming with `async function*`

## Tidying Practices
- **Guard clauses**: Move preconditions to top, return early
- **Helper variables**: Extract complex expressions
- **Dead code**: Delete unused code
- **Normalize symmetries**: Use consistent patterns

## Module Decomposition (ADR-016)
- Extract well-defined concerns into their own modules
- Use type-only imports to break circular dependencies
- Re-export types/functions from original module for backward compatibility
- Prefer mechanical extraction over design refactoring

## Testing
- Framework: `bun:test` with `describe`, `it`, `expect`
- Test files co-located or in `test/` mirroring `src/` structure
- Clean up resources in `beforeEach`/`afterEach`
- Test behavior, not implementation details
