# Technology Stack

**Analysis Date:** 2026-01-25

## Languages

**Primary:**

- TypeScript 5.9.3 - All source code written in TypeScript
- ES Modules with `type: "module"` in package.json

**Secondary:**

- JavaScript (JSX) - React components for CLI UI
- JSON - Configuration files and data interchange

## Runtime

**Environment:**

- Bun 1.x - Runtime and package manager
  - Installation: `bun install`, `bun run`, `bun test`
  - Executable: `tiny-agent` (compiled binary via `bun build --compile`)

**Package Manager:**

- Bun with `bun.lock` lockfile
- Lockfile version: 1

## Frameworks

**Core:**

- React 19.2.3 - UI component library for CLI
- Ink 6.6.0 - React-based CLI rendering framework
  - Location: `src/ui/` - All CLI UI components

**Testing:**

- bun:test - Built-in test framework
  - Config: No separate config, uses `bun test` directly
  - Assertions: `expect()` from bun:test
  - Fixtures: Co-located with tests in `test/` directory

**Build/Dev:**

- TypeScript 5.9.3 - Type checking and compilation
  - Config: `tsconfig.json` with strict mode
- oxfmt 0.26.0 - Code formatter
  - Config: `.oxfmtrc.json`
- oxlint 1.39.0 - Code linter
  - Config: `.oxlintrc.json` with TypeScript, unicorn, and oxc plugins

## Key Dependencies

**Critical:**

| Package             | Version | Purpose                                |
| ------------------- | ------- | -------------------------------------- |
| `openai`            | ^6.16.0 | OpenAI API client for GPT models       |
| `@anthropic-ai/sdk` | ^0.71.2 | Anthropic API client for Claude models |
| `ollama`            | ^0.6.3  | Ollama client for local LLM inference  |
| `zod`               | ^4.0.0  | Runtime validation for tool parameters |
| `tiktoken`          | ^1.0.15 | Token counting for context management  |

**Infrastructure:**

| Package                     | Version | Purpose                             |
| --------------------------- | ------- | ----------------------------------- |
| `@modelcontextprotocol/sdk` | ^1.25.2 | MCP client for server communication |
| `ink`                       | ^6.6.0  | React CLI rendering                 |
| `ink-box`                   | ^2.0.0  | Box styling for Ink                 |
| `ink-spinner`               | ^5.0.0  | Spinner component for Ink           |
| `yaml`                      | ^2.8.2  | YAML config file parsing            |

**Dev Dependencies:**

| Package        | Version | Purpose                      |
| -------------- | ------- | ---------------------------- |
| `@types/bun`   | latest  | Bun type definitions         |
| `@types/react` | ^19.2.8 | React type definitions       |
| `typescript`   | ^5.9.3  | TypeScript compiler          |
| `oxlint`       | ^1.39.0 | Linting                      |
| `oxfmt`        | ^0.26.0 | Formatting                   |
| `bumpp`        | ^10.4.0 | Version bumping for releases |
| `husky`        | ^9.1.7  | Git hooks                    |

## Configuration

**TypeScript:**

- File: `tsconfig.json`
- Key settings:
  - `target`: ESNext
  - `module`: NodeNext
  - `verbatimModuleSyntax`: true (explicit type imports)
  - `noUncheckedIndexedAccess`: true
  - `noImplicitOverride`: true
  - `jsx`: react-jsx
  - Path aliases: `@/*` maps to `src/*`

**Linting:**

- File: `.oxlintrc.json`
- Plugins: unicorn, typescript, oxc
- Key rules: TypeScript strict rules, best practices from oxc

**Formatting:**

- File: `.oxfmtrc.json`
- Tool: oxfmt (Oxc formatter)

**Environment:**

- Config location: `~/.tiny-agent/config.yaml` (default)
- Override with: `TINY_AGENT_CONFIG_YAML` or `TINY_AGENT_CONFIG_JSON`
- Env var overrides:
  - `TINY_AGENT_MODEL` - Override default model
  - `TINY_AGENT_SYSTEM_PROMPT` - Override system prompt
  - `TINY_AGENT_CONVERSATION_FILE` - Conversation history file
  - `TINY_AGENT_MEMORY_FILE` - Memory file location
  - `TINY_AGENT_MAX_CONTEXT_TOKENS` - Max context tokens
  - `TINY_AGENT_MAX_MEMORY_TOKENS` - Max memory tokens

## Platform Requirements

**Development:**

- macOS (primary) - Platform-specific binaries in lockfile
- Node.js compatibility - TypeScript targets NodeNext
- Git - For version control operations

**Production:**

- Binary deployment: `tiny-agent` compiled executable
- No runtime dependencies (self-contained via Bun compilation)
- Supports all platforms Bun supports (macOS, Linux, Windows)

---

_Stack analysis: 2026-01-25_
