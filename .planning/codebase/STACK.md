# Stack

## Languages & Runtime

- **TypeScript** (strict mode, ES modules) — see `tsconfig.json`. Notable compiler options:
  - `verbatimModuleSyntax` — requires explicit `import type` for type-only imports
  - `noUncheckedIndexedAccess` — indexed access returns `T | undefined`
  - `noImplicitOverride` — `override` keyword required on subclass overrides
- **Runtime**: Bun (>=1.x). Source extensions: `.ts`, `.tsx` (for Ink UI).
- **Path aliases**: `@/*` → repo root (e.g. `import { Tool } from "@/tools/types.js"`).

## Frontend / UI

- **React 18+ via Ink** (`ink` package) for the CLI UI layer (`src/ui/`).
- **boxen / ink-spinner / ink-text-input** for terminal layout, spinners, and text input.
- No browser-side code.

## Validation & Schemas

- **zod** for runtime validation of tool arguments and CLI inputs.
- **zod-to-json-schema** for OpenAI/Anthropic tool schema conversion.

## Linting / Formatting

- **Biome** (single tool for lint + format). Config: `biome.json`.
  - Indent: tabs
  - Quotes: double
  - Lint rules: `recommended` + `correctness`, `style`, `suspicious`, `performance`
  - Import organization enabled

## Build & Distribution

- **Bun compile** — `bun build index.ts --compile --outfile=tiny-agent` produces a self-contained native binary.
- **Embedded skills generation** — `bun run scripts/generate-embedded-skills.ts` walks `src/skills/builtin/` and emits `src/skills/embedded-content.ts` so skill content ships inside the binary.
- **Version generation** — `bun run scripts/generate-version.ts` writes `src/utils/version-constant.ts` from `package.json`.
- **Task runner**: `just` (Justfile). Recipes: `dev`, `build`, `test`, `lint`, `format`, `typecheck`, release patch/minor/major.

## Testing

- **bun:test** built-in test runner. 60+ test files mirroring `src/` under `test/`.
- **Coverage**: not configured; bun's `--coverage` flag is available.
- **Performance benchmarks**: `test/performance/benchmarks.test.ts`.
- **E2E**: `test/e2e/agent-loop.test.ts` exercises the full agent loop with stub providers.

## Dependencies (top-level from `package.json`)

| Package | Purpose |
|---|---|
| `@anthropic-ai/sdk` | Anthropic provider |
| `openai` | OpenAI / OpenAI-compatible providers |
| `ink`, `react` | CLI UI |
| `zod`, `zod-to-json-schema` | Runtime schema validation |
| `@modelcontextprotocol/sdk` | MCP client integration |
| `chokidar` | File watching for config reloads |
| `yaml` | YAML parsing (skills frontmatter, config) |
| `pino` | Structured logging |

Dev: `@types/*`, `bun-types`, `@biomejs/biome`.

## Configuration Surface

- `tsconfig.json` — strict TS config.
- `biome.json` — lint + format.
- `package.json` — scripts, deps, `bumpp` for releases.
- `cspell.json` — spell-check dictionary.
- `renovate.json` — automated dependency updates.
- `.github/workflows/ci.yml`, `.github/workflows/release.yml` — CI + release.
- `tiny-agent.json` (project-local) and `~/.config/tiny-agent/config.json` (user) — runtime config, loaded via `src/config/loader.ts`.
