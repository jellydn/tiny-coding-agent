# Technology Stack

**Analysis Date:** 2026-01-25

## Languages

**Primary:**

- TypeScript 5.9.3 - All application code, configuration, and tests

**Secondary:**

- JavaScript (ESNext) - Generated runtime code via Bun compiler

## Runtime

**Environment:**

- Bun 1.x (latest) - JavaScript runtime and package manager
- Node.js compatible - Uses `node:fs/promises`, `node:path`, `node:os`, `node:url` modules

**Package Manager:**

- Bun (bundled with runtime)
- Lockfile: `bun.lock` (present)

## Frameworks

**Core:**

- None - Minimal framework, uses vanilla TypeScript
- React 19.2.3 - For CLI UI (ink components)

**Testing:**

- bun:test - Built-in test runner for Bun
- No assertion library (uses built-in `expect`)

**Build/Dev:**

- Bun build --compile - Compiles TypeScript to standalone binary (`tiny-agent`)
- TypeScript 5.9.3 - Type checking (`tsc --noEmit`)
- oxlint 1.39.0 - Linting
- oxfmt 0.26.0 - Code formatting
- husky 9.1.7 - Git hooks
- bumpp 10.4.0 - Version bumping for releases

## Key Dependencies

**Critical (LLM Providers):**

- `@anthropic-ai/sdk` 0.71.2 - Anthropic Claude API client
- `openai` 6.16.0 - OpenAI API client (also used by OpenRouter, OpenCode)
- `ollama` 0.6.3 - Ollama local/remote LLM client
- `tiktoken` 1.0.15 - Token counting for context management

**Infrastructure:**

- `@modelcontextprotocol/sdk` 1.25.2 - MCP client for extending tool capabilities
- `zod` 4.0.0 - Schema validation for tool arguments
- `yaml` 2.8.2 - YAML configuration file parsing
- `react` 19.2.3 - React for ink CLI components
- `ink` 6.6.0 - React-based CLI rendering
- `ink-box` 2.0.0 - Box styling for ink
- `ink-spinner` 5.0.0 - Spinner component for ink

## Configuration

**Environment:**

- Config file location: `~/.tiny-agent/config.yaml` or `~/.tiny-agent/config.json`
- Env var overrides: `TINY_AGENT_MODEL`, `TINY_AGENT_SYSTEM_PROMPT`, `TINY_AGENT_CONVERSATION_FILE`, `TINY_AGENT_MEMORY_FILE`, `TINY_AGENT_MAX_CONTEXT_TOKENS`, `TINY_AGENT_MAX_MEMORY_TOKENS`
- Env var interpolation: `${VAR_NAME}` syntax supported in config

**Build:**

- `tsconfig.json` - TypeScript configuration with strict mode, paths alias `@/*`
- `tsconfig.json` settings: `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `noImplicitOverride`

## Platform Requirements

**Development:**

- Bun 1.x
- TypeScript 5.x
- Git
- npmjs.com account (for publishing)

**Production:**

- Linux/macOS (compiled binary `tiny-agent`)
- No external runtime dependencies when compiled
- For source: Bun runtime

---

_Stack analysis: 2026-01-25_
