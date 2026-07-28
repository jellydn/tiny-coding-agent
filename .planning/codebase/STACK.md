# Technology Stack

## Languages & Runtime

| Property | Value |
|----------|-------|
| Language | TypeScript 5+ (strict mode) |
| Runtime | Bun (latest) |
| Module system | ES modules (`"type": "module"`) |
| Target | ESNext |
| Module resolution | NodeNext |
| JSX | react-jsx (Ink CLI components) |
| Package manager | Bun (bun.lock) |
| Version | 0.6.0 |

## Configuration Files

| File | Purpose |
|------|---------|
| `package.json` | Dependencies, scripts, project metadata |
| `tsconfig.json` | TypeScript compiler options (strict, NodeNext, `@/*` path alias) |
| `biome.json` | Linter + formatter config (tab indentation, 120 char width, double quotes) |
| `bun.lock` | Bun lockfile (v1) |
| `prek.toml` | Pre-commit hook configuration |
| `cspell.json` | Spell-check configuration |
| `renovate.json` | Dependency auto-update configuration |
| `bump.config.ts` | Version bump configuration (bumpp) |

## Key Dependencies

### AI / LLM SDKs

| Package | Purpose | Used in |
|---------|---------|---------|
| `openai` | OpenAI API client (also used for OpenRouter, OpenCode, Z.AI, ClinePass, QwenCloud) | `src/providers/openai.ts`, `src/providers/openrouter.ts`, etc. |
| `@anthropic-ai/sdk` | Anthropic Claude API client | `src/providers/anthropic.ts` |
| `ollama` | Ollama local + cloud API client | `src/providers/ollama.ts`, `src/providers/ollama-cloud.ts` |

### CLI / UI

| Package | Purpose | Used in |
|---------|---------|---------|
| `ink` | React for CLI terminal apps | `src/ui/` (all components) |
| `ink-box` | Box component for Ink | `src/ui/components/` |
| `ink-spinner` | Spinner component for Ink | `src/ui/components/Spinner.tsx` |
| `react` | React runtime (for Ink) | `src/ui/` |
| `react-devtools-core` | DevTools integration | Dev mode only |

### Utilities

| Package | Purpose | Used in |
|---------|---------|---------|
| `yaml` | YAML parsing/serializing for config files | `src/config/loader.ts`, `src/config/config-io.ts` |
| `zod` | Runtime validation for configs and tool inputs | `src/config/schema.ts`, `src/tools/` |
| `tiktoken` | Token counting for context budgeting | `src/core/tokens.ts` |
| `@tokenlens/models` | Model token limits | `src/providers/capabilities.ts` |

### Telemetry / Observability

| Package | Purpose | Used in |
|---------|---------|---------|
| `@opentelemetry/api` | OpenTelemetry tracing API | `src/observability/telemetry.ts` |
| `@opentelemetry/sdk-trace-base` | OpenTelemetry SDK (tracer provider, exporters) | `src/observability/telemetry.ts` |
| `langfuse` (optional) | LLM observability platform integration | `src/observability/langfuse.ts` |

### MCP

| Package | Purpose | Used in |
|---------|---------|---------|
| `@modelcontextprotocol/sdk` | Model Context Protocol client SDK | `src/mcp/client.ts`, `src/mcp/manager.ts` |

## Dev Dependencies

| Package | Purpose |
|---------|---------|
| `@biomejs/biome` | Linter + formatter (replaces ESLint + Prettier) |
| `@types/bun` | Type definitions for Bun runtime |
| `@types/react` | Type definitions for React |
| `typescript` | TypeScript compiler (peer dependency) |
| `bumpp` | Version bumping for releases |
| `husky` | Git hooks management |

## Build & Release

### Scripts (from `package.json`)

```bash
bun run dev              # Watch mode (bun --watch index.ts)
bun run build            # Compile to binary (outputs tiny-agent)
bun run generate:skills  # Regenerate embedded skills
bun run generate:version # Generate version constant
bun run typecheck        # tsc --noEmit (with version generation)
bun run lint             # biome check .
bun run lint:fix         # biome check --write --unsafe .
bun run format           # biome format . --write
bun test                 # Run all tests (bun test)
bun test:watch           # Watch mode tests
bun run release:patch    # Patch release (test → typecheck → lint → bumpp)
bun run release:minor    # Minor release
bun run release:major    # Major release
```

### Build Output

The build compiles to a single binary using `bun build --compile`:

```
index.ts → bun build --compile → tiny-agent (standalone binary)
```

### CI Pipeline (`.github/workflows/ci.yml`)

- **Triggers**: Push to `main`, pull requests to `main`
- **Jobs**: `lint` (ubuntu-latest), `test` (ubuntu-latest + macos-latest), `build` (conditional)
- **Setup**: Bun latest, dependency caching via `oven-sh/setup-bun@v2`

### Release Pipeline (`.github/workflows/release.yml`)

- Automated releases via bumpp + GitHub Actions
- Homebrew formula in `.github/homebrew-tiny-agent/tiny-agent.rb`

## TypeScript Configuration

Key compiler options from `tsconfig.json`:

- `strict: true` — strict mode
- `verbatimModuleSyntax` — requires explicit `import type` for types
- `noUncheckedIndexedAccess` — indexed access requires validation
- `noImplicitOverride` — override methods must use `override` keyword
- `path alias`: `@/*` → `./src/*`
- `module: NodeNext`, `moduleResolution: NodeNext`

## Linting & Formatting (Biome)

- Tab indentation (width 2)
- 120 character line width
- Double quotes
- Semicolons enabled
- ES5 trailing commas
- Disabled rules: `noNonNullAssertion`, `noNonNullAssertedOptionalChain`, `noArrayIndexKey`, `noAssignInExpressions`
- Auto-organize imports on save
- `src/skills/embedded-content.ts` excluded (generated file)
