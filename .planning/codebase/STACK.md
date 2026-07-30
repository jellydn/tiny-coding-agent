# Technology Stack

## Language & Runtime
- **Language:** TypeScript 5+ (strict mode)
- **Runtime:** Bun (v1.x) — JavaScript runtime, bundler, test runner
- **Module system:** ESM (`"type": "module"` in package.json)

## Core Dependencies
| Dependency | Purpose |
|------------|---------|
| `ink` ^7.1.1 | React for CLI — UI rendering |
| `react` ^19.2.3 | UI component model |
| `zod` ^4.0.0 | Runtime validation of configs and inputs |
| `yaml` ^2.8.2 | Config file parsing |
| `tiktoken` ^1.0.15 | Token counting |
| `@tokenlens/models` ^1.3.0 | Model token limits |
| `@opentelemetry/api` ^1.9.1 | Observability spans |

## Provider SDKs
| SDK | Provider |
|-----|----------|
| `openai` ^7.0.0 | OpenAI, OpenRouter, Zai, QwenCloud, ClinePass |
| `@anthropic-ai/sdk` ^0.115.0 | Anthropic Claude |
| `ollama` ^0.6.3 | Local Ollama models |
| `@modelcontextprotocol/sdk` ^1.25.2 | MCP servers |

## Dev Dependencies
| Dependency | Purpose |
|------------|---------|
| `@biomejs/biome` ^2.3.8 | Linting + formatting |
| `typescript` ^7.0.0 | Type checking |
| `bumpp` ^12.0.0 | Version bumping |
| `husky` ^9.1.7 | Pre-commit hooks |
| `@types/bun` | Bun type definitions |

## Configuration
| File | Purpose |
|------|---------|
| `tsconfig.json` | TypeScript strict mode, `verbatimModuleSyntax` |
| `biome.json` | Linting + formatting rules (2.3.x schema) |
| `bump.config.ts` | Version bump config (bumpp) |
| `package.json` | Dependencies, scripts, version |

## Scripts
- `bun run dev` — Watch mode
- `bun run build` — Compile to binary (outputs `tiny-agent`)
- `bun test` — Run all tests
- `bun run typecheck` — tsc --noEmit
- `bun run lint`/`lint:fix` — Biome check
- `bun run format`/`format:check` — Biome format
- `bun run release:minor` — Test + typecheck + lint + bumpp minor

## Version History
- v0.5.0, v0.5.1 — Foundation
- v0.6.0 — Agent decomposition
- v0.7.0 — Multi-agent + hooks + QwenCloud
- v0.8.0 — Round 5 extractions (tool-status, SyntaxHighlighter, plan-converter, help-text, Login Flow Controller, stable prompt fix)
