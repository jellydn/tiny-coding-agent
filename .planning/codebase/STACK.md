# Stack

## Languages & Runtime

- **TypeScript** (strict mode, ES modules) — see `tsconfig.json`. Notable compiler options:
  - `verbatimModuleSyntax` — requires explicit `import type` for type-only imports
  - `noUncheckedIndexedAccess` — indexed access returns `T | undefined`
  - `noImplicitOverride` — `override` keyword required on subclass overrides
- **Runtime**: Bun (>=1.x). Source extensions: `.ts`, `.tsx` (for Ink UI).
- **Path aliases**: `@/*` → `./src/*` (e.g. `import { Tool } from "@/tools/types.js"`).

## Frontend / UI

- **React 18+ via Ink** (`ink` package) for the CLI UI layer (`src/ui/`).
- **ink-box / ink-spinner / ink-text-input** for terminal layout, spinners, and text input.
- No browser-side code.

## Validation & Schemas

- **zod** for runtime validation of tool arguments and CLI inputs.
- **zod-to-json-schema** for OpenAI/Anthropic tool schema conversion.

## Linting / Formatting

- **Biome** (single tool for lint + format). Config: `biome.json`.
  - Indent: tabs
  - Quotes: double
  - Line width: 120
  - Lint rules: `recommended` + `correctness`, `style`, `suspicious`, `performance`
  - Disabled rules: `noNonNullAssertion`, `noNonNullAssertedOptionalChain`, `noArrayIndexKey`, `noAssignInExpressions`
  - Import organization enabled (`assist/source/organizeImports`)
- **prek** (pre-commit hooks). Config: `prek.toml`.
  - Trailing whitespace, EOF fixer, YAML/large file checks
  - Local hooks for `biome check` (lint+format) and `tsc --noEmit` (typecheck)

## Build & Distribution

- **Bun compile** — `bun build index.ts --compile --outfile=tiny-agent` produces a self-contained native binary.
- **Embedded skills generation** — `bun run scripts/generate-embedded-skills.ts` walks `src/skills/builtin/` and emits `src/skills/embedded-content.ts` so skill content ships inside the binary.
- **Version generation** — `bun run scripts/generate-version.ts` writes `src/utils/version-constant.ts` from `package.json`.
- **Task runner**: `just` (Justfile). Recipes: `dev`, `build`, `test`, `lint`, `format`, `typecheck`, `check`, `pre`, release patch/minor/major.
- **Release**: `bumpp` (via `bump.config.ts`) for version bumping. GitHub Actions release workflow in `.github/workflows/release.yml`.

## Testing

- **bun:test** built-in test runner. 65 test files mirroring `src/` under `test/`.
- **Coverage**: not configured; bun's `--coverage` flag is available.
- **Performance benchmarks**: `test/performance/benchmarks.test.ts`.
- **E2E**: `test/e2e/agent-loop.test.ts` exercises the full agent loop with stub providers.

## Dependencies (top-level from `package.json`)

| Package | Purpose |
|---|---|
| `@anthropic-ai/sdk` | Anthropic provider |
| `openai` | OpenAI / OpenAI-compatible providers |
| `ollama` | Ollama API client |
| `tiktoken` | Token counting (OpenAI tokenizer) |
| `ink`, `react` | CLI UI (React for terminals) |
| `ink-box`, `ink-spinner`, `ink-text-input` | Terminal layout components |
| `zod`, `zod-to-json-schema` | Runtime schema validation + JSON Schema conversion |
| `@modelcontextprotocol/sdk` | MCP client integration |
| `@opentelemetry/api` | OpenTelemetry tracing |
| `chokidar` | File watching for config reloads |
| `yaml` | YAML parsing (skills frontmatter, config) |
| `pino` | Structured logging |
| `boxen` | Terminal boxes (CLI output) |

Dev: `@types/*`, `bun-types`, `@biomejs/biome`, `bumpp`.

## Configuration Surface

| File | Purpose |
|---|---|
| `tsconfig.json` | Strict TS config, ESM, path aliases |
| `biome.json` | Lint + format rules |
| `package.json` | Scripts, deps, release metadata |
| `bump.config.ts` | Version bump configuration |
| `cspell.json` | Spell-check dictionary |
| `prek.toml` | Pre-commit hook configuration |
| `renovate.json` | Automated dependency updates |
| `.github/workflows/ci.yml` | CI: typecheck + lint + tests + build |
| `.github/workflows/release.yml` | Release pipeline |
| `Justfile` | Task runner recipes |
| `Makefile` | Legacy wrapper (same recipes) |
| `~/.tiny-agent/config.yaml` | User runtime config (YAML or JSON) |
| `tiny-agent.json` | Project-local config override |

## CI/CD

- **GitHub Actions CI** (`.github/workflows/ci.yml`): runs `bun test` + `bun run check` (lint + typecheck) on every PR.
- **GitHub Actions Release** (`.github/workflows/release.yml`): triggered on version tags, builds binary for multiple platforms, publishes GitHub Release + Homebrew tap.
- **Renovate** (`renovate.json`): automated dependency PRs.
- **Husky pre-commit** (`.husky/pre-commit`): runs `prek` hooks (biome + tsc).
