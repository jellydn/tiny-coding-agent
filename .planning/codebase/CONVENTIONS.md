# Conventions

Driven by `AGENTS.md`, `CLAUDE.md`, and `biome.json`. All enforced by Biome lint + format on save / pre-commit (via `prek`).

## Imports

- Node built-ins: prefix with `node:`.
  ```ts
  import * as fs from "node:fs/promises";
  import { createInterface } from "node:readline";
  import { chmod, readFile, writeFile } from "node:fs/promises";
  ```
- External deps: bare specifier.
  ```ts
  import OpenAI from "openai";
  ```
- Internal imports: `.js` extension (ESM) and `@/*` alias when crossing `src/`.
  ```ts
  import type { Tool } from "@/tools/types.js";
  import { parse as parsePlanGrammar } from "./plan-grammar.js";
  ```
- Type-only imports: `import type { Foo }` (enforced by `verbatimModuleSyntax`).
- Imports are auto-sorted by Biome — do not hand-reorder.

## Naming

| Kind | Convention | Example |
|---|---|---|
| Files | kebab-case | `plan-grammar.ts`, `config-io.ts` |
| Classes / types / React components | PascalCase | `ToolRegistry`, `BuildStep`, `TurnExecutor` |
| Functions / variables | camelCase | `parsePlanToSteps`, `createAgent` |
| Constants | SCREAMING_SNAKE_CASE | `BUILD_SYSTEM_PROMPT`, `LOOP_DETECTION` |
| Private members | `_prefix` | `_tools`, `_registry`, `_promptFn` |
| React props | `interface XProps` or inline | `<Message ... />` |

## Strings & Variables

```ts
const message = "text";          // double quotes
let count = 0;                   // let only when reassigning
const timeout = args.timeout ?? 60000;  // ?? for nullish defaults
```

## TypeScript Style

- Strict mode (see `tsconfig.json`).
- Prefer `satisfies` for type narrowing with runtime validation.
- Use `zod` for runtime input validation (tools, configs, env vars).
- `noUncheckedIndexedAccess` — every `arr[i]` is `T | undefined`; check before use.
- `noImplicitOverride` — `override` keyword required on subclass overrides.
- Use `as const` for literal type narrowing (e.g. `{ type: "object" as const }`).

## React / JSX (Ink)

- Function components with TypeScript prop interfaces.
- No class components.
- Use contexts (`src/ui/contexts/`) for cross-cutting state.

## Error Handling

Return structured results, never throw for expected failures.

```ts
async function readSomething(path: string): Promise<Result<string>> {
  try {
    const data = await fs.readFile(path, "utf-8");
    return { success: true, data };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return { success: false, error: `Not found: ${path}` };
    return { success: false, error: e.message };
  }
}
```

Use specific error codes: `ENOENT`, `EACCES`, `EISDIR`, `ENOTDIR`. Avoid `any`; cast as `NodeJS.ErrnoException` for fs errors.

**Exception**: CLI handlers (`src/cli/handlers/*`) may call `process.exit(code)` after `console.error` for user-facing errors (e.g. invalid args, login cancellation). This is the accepted pattern for top-level CLI commands.

**Note**: `promptHidden()` currently calls `process.exit(0)` on Ctrl+C. PR #67 (`fix/design-smells`) changes this to reject the promise with `new Error("Interrupted by user (Ctrl+C)")` so callers can `try/catch` — pending merge.

## Async Patterns

```ts
async function fetchData(url: string): Promise<Result<Data>> {
  try {
    const res = await fetch(url);
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    return { success: true, data: await res.json() };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
```

## Tool Authoring (`src/tools/`)

- Each tool is a `Tool` object (`src/tools/types.ts`):
  - `name` — kebab-case, globally unique.
  - `description` — short, used by the LLM to decide when to call.
  - `parameters` — JSON Schema for the args.
  - `dangerous` — string | boolean | function. When truthy, the registry routes through `src/tools/confirmation.ts` before executing.
  - `execute(args) → Promise<ToolResult>` — never throw; return `{ success, output?, error? }`.
- Validate `args` with zod at the top of `execute`.

## CLI Authoring (`src/cli/handlers/`)

- Each handler exports an async function `(args, config?, options?) → Promise<void>`.
- Handlers never throw to the user — they `console.error` and `process.exit(code)`.
- Exit codes: `0` ok, `1` runtime error, `2` usage error.
- **Login/logout** are special: dispatched before `loadConfig()` so they work without an existing config (ADR-014).

## Config I/O (`src/config/config-io.ts`)

- All config file reading/writing goes through `readConfigFile()` / `writeConfigFile()`.
- `writeConfigFile()` uses `mode: 0o600` on file creation when `containsLiteralApiKey()` returns true. PR #67 adds `chmod` after write to enforce `0o600` on existing files — pending merge.
- Never inline `await import("yaml")` or `writeFile` for config operations — use the shared module.

## Prompting (`src/cli/prompt.ts`)

- All readline-based user input goes through `prompt()`, `promptHidden()`, or `promptChoice()`.
- `promptHidden()` uses raw-mode `*` masking in TTY, falls back to plain readline in non-TTY.
- `promptChoice()` currently returns `options[0] ?? ""` on no match (silent first-option fallback). PR #67 changes this to return `null` — pending merge.
- Never inline `createInterface` from `node:readline` — use the shared module.

## Dependency Injection

- Prefer dependency injection over module-level mocking.
- `StepExecutor` accepts an optional `promptFn` in `StepExecutorOptions` — tests pass a `vi.fn()` mock.
- `ToolRegistry` is injectable — tests pass a registry pre-loaded with stubs.
- Provider factory accepts a `providers` map — tests inject a stub provider.

## Circular Dependency Breaking

When extracting a module creates a runtime cycle, use the established pattern:
1. Move shared utilities to a separate `*-utils.ts` file (e.g. `agent-utils.ts`).
2. Use `import type` for type-only imports (erased at compile time, no runtime cycle).
3. Re-export from the original file for backward compatibility.
- Example: `turn-executor.ts` imports from `agent-utils.ts` (not `agent.ts`); `agent.ts` re-exports from `agent-utils.ts`.
- Example: `step-executor.ts` uses `import type` for `BuildAction`/`BuildStep` from `build-agent.ts`; `build-agent.ts` re-exports `mapBuildAction` from `step-executor.ts`.

## Logging / Output

- Structured logger via `src/observability/logger.ts`; never `console.log` from the agent loop.
- Ink UI uses `console.log` for terminal output that bypasses the UI (e.g. `--upgrade`, `login`).
- CLI handlers use `console.log` for user-facing output and `console.error` for errors.

## File Organization

- One concern per file.
- `index.ts` barrel re-exports for ergonomic imports — but only when there are >2 exports.
- Generated files (`src/utils/version-constant.ts`, `src/skills/embedded-content.ts`) are excluded from git diff lint.

## Style Enforcement

- `bun run lint` — Biome checks.
- `bun run format` — Biome write.
- `bun run lint:fix` — Biome write + auto-fix.
- Pre-commit hook runs `prek` which executes `biome check` (staged files) and `tsc --noEmit` (full project) via `.husky/pre-commit`.
