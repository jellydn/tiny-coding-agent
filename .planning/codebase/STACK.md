# Technology Stack

**Analysis Date:** 2026-01-25

## Languages

**Primary:**
- TypeScript 5.9 - All application code, configuration, and tests

**Secondary:**
- JavaScript - No separate .js source files; TypeScript with ES modules

## Runtime

**Environment:**
- Bun 1.x - JavaScript runtime and package manager
- Target: Node.js compatible (ES modules)

**Package Manager:**
- Bun (bundled with runtime)
- Lockfile: `bun.lock` (present)

## Frameworks

**Core:**
- React 19.2.3 - UI component library (for CLI interface)
- Ink 6.6.0 - React for CLI (render React components to terminal output)
- Zod 4.0.0 - Runtime schema validation for configs and inputs

**Testing:**
- bun:test - Built-in test runner for Bun
- No external assertion library; uses bun:test's built-in `expect`

**Build/Dev:**
- TypeScript 5.9.3 - Type checking and compilation
- oxfmt - Code formatter (configured in `.oxfmtrc.json`)
- oxlint 1.39.0 - Linter (configured in `.oxlintrc.json`)
- bumpp - Version bumping for releases

## Key Dependencies

**LLM Providers:**
- `@anthropic-ai/sdk` 0.71.2 - Anthropic Claude API client
- `openai` 6.16.0 - OpenAI GPT API client
- `ollama` 0.6.3 - Ollama local LLM client

**Protocols & Tools:**
- `@modelcontextprotocol/sdk` 1.25.2 - MCP client/server implementation
- `tiktoken` 1.0.15 - BPE token counting for context management

**Utilities:**
- `yaml` 2.8.2 - YAML config file parsing
- `react` 19.2.3 - React core (peer dependency for Ink)

**CLI UI:**
- `ink-box` 2.0.0 - Box component for Ink
- `ink-spinner` 5.0.0 - Spinner component for Ink

## Configuration

**Environment:**
- Config files: `~/.tiny-agent/config.yaml` (YAML) or `~/.tiny-agent/config.json` (JSON)
- Environment variable overrides for core settings
- Environment variable interpolation in config (`${VAR_NAME}` syntax)
- Sensitive values (API keys) must use env var syntax, not hardcoded

**Key env vars:**
- `TINY_AGENT_CONFIG_YAML` - Custom config file path
- `TINY_AGENT_CONFIG_JSON` - Custom JSON config path
- `TINY_AGENT_MODEL` - Override default model
- `TINY_AGENT_SYSTEM_PROMPT` - Override system prompt
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc. - Provider API keys

**Build:**
- `tsconfig.json` - TypeScript configuration with strict mode
- `verbatimModuleSyntax`: Requires explicit `import type` for types
- `noUncheckedIndexedAccess`: Accessing indexed types requires validation
- `noImplicitOverride`: Override methods must use `override` keyword
- Paths alias: `@/*` maps to `src/*`

**Linting:**
- `.oxlintrc.json` - oxlint configuration
- `.oxfmtrc.json` - oxfmt configuration

## Platform Requirements

**Development:**
- Bun 1.x runtime
- TypeScript 5.9+
- Git for version control
- npm/npx for MCP server bootstrapping (e.g., `npx @upstash/context7-mcp`)

**Production:**
- Compiled binary: `tiny-agent` (Bun compile output)
- No runtime dependencies (standalone binary)
- Local LLM (Ollama) optional for offline use
- MCP servers require separate installation

---

*Stack analysis: 2026-01-25*
