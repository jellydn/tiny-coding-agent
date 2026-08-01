# STACK.md — Technology Stack

## Runtime & Language

- **Runtime**: [Bun](https://bun.sh/) v1.x (fast all-in-one JS/TS runtime)
- **Language**: TypeScript 7+ with strict mode
- **Module System**: ES Modules (`"type": "module"` in package.json)
- **Target**: ESNext
- **Module Resolution**: NodeNext

## Core Framework

- **CLI UI**: [Ink](https://github.com/vadimdemedes/ink) v7 (React for CLI)
  - `ink-box` — box layout
  - `ink-spinner` — loading spinners
  - `react` v19 — JSX rendering engine
- **Schema Validation**: [Zod](https://zod.dev/) v4 (runtime input/config validation)

## LLM Providers

| Provider | Package | Purpose |
|----------|---------|---------|
| OpenAI | `openai` v7 | GPT models, OpenCode, OpenRouter, ClinePass |
| Anthropic | `@anthropic-ai/sdk` v0.115 | Claude models |
| Ollama | `ollama` v0.6 | Local model inference |
| QwenCloud | (OpenAI-compatible) | Qwen/DeepSeek models |
| Z.ai | (OpenAI-compatible) | GLM models |

## Tooling & Infrastructure

- **Tokenization**: `tiktoken` v1 (OpenAI-compatible token counting)
- **MCP**: `@modelcontextprotocol/sdk` v1.25 (Model Context Protocol client)
- **Observability**: `@opentelemetry/api` v1.9 + `@opentelemetry/sdk-trace-base` v2.10
- **Model Catalog**: `@tokenlens/models` v1.3 (model capabilities database)
- **Config**: YAML via `yaml` v2.8

## Dev Tooling

- **Linter/Formatter**: [Biome](https://biomejs.dev/) v2.3 (replaces ESLint + Prettier)
- **Pre-commit**: Husky v9
- **Versioning**: bumpp v12 (conventional commits)
- **Spell Check**: cspell
- **Dependencies**: Renovate (automated updates)

## Build & Release

```bash
bun run build          # Compiles to standalone binary (tiny-agent)
bun run release:patch  # test → typecheck → lint → bumpp patch
bun run release:minor  # test → typecheck → lint → bumpp minor
bun run release:major  # test → typecheck → lint → bumpp major
```

## Key Configuration Files

| File | Purpose |
|------|---------|
| `package.json` | Dependencies, scripts, metadata |
| `tsconfig.json` | TypeScript compiler options |
| `biome.json` | Linting & formatting rules |
| `bump.config.ts` | Version bump configuration |
| `renovate.json` | Dependency update automation |
| `cspell.json` | Spell checking dictionary |
| `.husky/pre-commit` | Pre-commit hook (biome check) |
| `.github/workflows/ci.yml` | CI pipeline |
| `.github/workflows/release.yml` | Release automation |
