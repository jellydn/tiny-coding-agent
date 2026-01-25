# Codebase Structure

**Analysis Date:** 2026-01-25

## Directory Layout

```
tiny-coding-agent/
├── index.ts                    # Primary entry point
├── package.json                # Project manifest (bun)
├── tsconfig.json               # TypeScript config
├── .oxlintrc.json              # Linting config
├── .oxfmtrc.json               # Formatting config
├── bump.config.ts              # Release config
├── cspell.json                 # Spell check config
├── renovate.json               # Dependency updates config
│
├── src/
│   ├── core/                   # Agent loop, memory, conversation
│   ├── tools/                  # Built-in tools (file, bash, grep, glob, web)
│   ├── providers/              # LLM clients (OpenAI, Anthropic, Ollama, etc.)
│   ├── mcp/                    # MCP client integration
│   ├── cli/                    # CLI interface, command handlers
│   ├── config/                 # Configuration loading and schema
│   ├── skills/                 # Skill discovery and loading
│   ├── ui/                     # React/Ink components for CLI output
│   ├── utils/                  # Shared utilities (retry, XML, command)
│   └── index.ts                # Core exports barrel
│
├── test/                       # Test files (mirrors src structure)
│   ├── core/
│   ├── tools/
│   ├── providers/
│   ├── mcp/
│   ├── cli/
│   ├── skills/
│   ├── security/
│   ├── e2e/
│   ├── performance/
│   └── *.test.ts
│
├── scripts/                    # Build/generation scripts
│   ├── generate-embedded-skills.ts
│   └── ralph/                  # PRD and planning documents
│
├── .planning/codebase/         # Generated architecture docs (this file)
│
└── .skills/                    # Default skill directory
```

## Directory Purposes

**`src/core/`:**

- Purpose: Agent loop orchestration, memory management, conversation history
- Contains: `agent.ts` (main Agent class), `memory.ts` (MemoryStore), `conversation.ts` (ConversationManager), `tokens.ts` (token counting)
- Key files: `agent.ts` (849 lines), `memory.ts` (410 lines)

**`src/tools/`:**

- Purpose: Built-in tool implementations
- Contains: Tool registry, file operations, bash execution, search tools, web search, plugin loader
- Key files: `registry.ts` (155 lines), `file-tools.ts`, `bash-tool.ts`, `search-tools.ts`, `skill-tool.ts`
- Subdirs: `search-providers/` (DuckDuckGo integration)

**`src/providers/`:**

- Purpose: LLM client implementations for different providers
- Contains: OpenAI, Anthropic, Ollama, OpenRouter, OpenCode providers, factory pattern
- Key files: `factory.ts` (63 lines), `types.ts` (67 lines), `model-registry.ts` (model detection)
- Subdirs: None (flat structure)

**`src/mcp/`:**

- Purpose: Model Context Protocol client integration
- Contains: `McpManager` class, `McpClient` class, types
- Key files: `manager.ts` (223 lines), `client.ts`, `types.ts`, `index.ts`

**`src/cli/`:**

- Purpose: Command-line interface, command handlers
- Contains: `main.tsx` (1366 lines - largest file), command handlers
- Key files: `main.tsx` (CLI router and handlers), `index.ts` (exports), `status-line.ts`, `chat-commands.ts`

**`src/config/`:**

- Purpose: Configuration loading from YAML/JSON, validation, schema
- Contains: `loader.ts`, `schema.ts`, `index.ts`
- Key files: `loader.ts` (237 lines), `schema.ts` (157 lines)

**`src/skills/`:**

- Purpose: Skill discovery, parsing, loading, embedded registry
- Contains: Skill types, loader, parser, prompt generator, builtin registry
- Key files: `loader.ts`, `parser.ts`, `prompt.ts`, `builtin-registry.ts`, `types.ts`
- Special: `embedded-content.ts` (generated embedded skills)

**`src/ui/`:**

- Purpose: React/Ink components for interactive CLI
- Contains: App component, status line manager, tool output components
- Key files: `index.ts`, `status-line-manager.ts`, `utils.ts`
- Subdirs: `components/`, `hooks/`, `errors/`, `types/`, `config/`, `contexts/`

**`src/utils/`:**

- Purpose: Shared utilities used across the codebase
- Contains: `retry.ts` (retry logic), `xml.ts` (XML escaping), `command.ts` (command availability)
- Key files: Minimal utilities, typically single-purpose functions

## Key File Locations

**Entry Points:**

- `index.ts` - Primary entry point (7 lines, delegates to CLI main)
- `src/cli/main.tsx` - CLI router and handlers (1366 lines)
- `src/cli/index.ts` - CLI barrel export

**Configuration:**

- `src/config/loader.ts` - Load config from `~/.tiny-agent/config.yaml` or `config.json`
- `src/config/schema.ts` - Config validation and TypeScript types

**Core Logic:**

- `src/core/agent.ts` - Main Agent class with `runStream()` generator
- `src/core/memory.ts` - MemoryStore for persistent context
- `src/core/conversation.ts` - ConversationManager for session history
- `src/core/tokens.ts` - Token counting utilities (tiktoken or fallback)

**Tool System:**

- `src/tools/registry.ts` - ToolRegistry class for tool management
- `src/tools/types.ts` - Tool interface definition
- `src/tools/file-tools.ts` - File read/write/edit tools
- `src/tools/bash-tool.ts` - Bash execution tool
- `src/tools/skill-tool.ts` - Dynamic skill loading tool

**LLM Providers:**

- `src/providers/factory.ts` - Factory for creating LLM clients by model name
- `src/providers/types.ts` - LLMClient interface and message types
- `src/providers/openai.ts` - OpenAI provider implementation
- `src/providers/anthropic.ts` - Anthropic provider implementation
- `src/providers/ollama.ts` - Ollama local provider

**MCP Integration:**

- `src/mcp/manager.ts` - McpManager for MCP server lifecycle
- `src/mcp/client.ts` - McpClient for server connection
- `src/mcp/types.ts` - MCP-specific types

**Testing:**

- `test/` - Test files mirroring src structure
- `test/core/agent.test.ts` - Agent tests
- `test/tools/file-tools.test.ts` - File tool tests
- `test/e2e/agent-loop.test.ts` - End-to-end tests

## Naming Conventions

**Files:**

- `kebab-case.ts` for implementation files (e.g., `file-tools.ts`, `bash-tool.ts`)
- `kebab-case.test.ts` for test files (e.g., `file-tools.test.ts`)
- `index.ts` for barrel files
- `.tsx` extension for React components (e.g., `main.tsx`)

**Directories:**

- `lowercaseplural/` for module directories (e.g., `core/`, `tools/`, `providers/`)

**Classes/Types:**

- `PascalCase` for classes and exported types (e.g., `Agent`, `MemoryStore`, `ToolRegistry`)
- `camelCase` for private/internal class members (e.g., `_memoryStore`, `_maxIterations`)

**Functions:**

- `camelCase` for functions (e.g., `createProvider()`, `loadConfig()`)
- `_prefix` for private methods (e.g., `_initializeSkills()`, `_evictIfNeeded()`)

**Constants:**

- `SCREAMING_SNAKE_CASE` for constants (e.g., `MAX_OUTPUT_LENGTH`, `SAVE_DEBOUNCE_MS`)

**Variables:**

- `camelCase` for variables (e.g., `toolRegistry`, `llmClient`)
- `const` by default, `let` only when reassigning

**Imports:**

- Node.js built-ins with `node:` prefix: `import * as fs from "node:fs/promises"`
- External packages: `import OpenAI from "openai"`
- Internal with `.js` extension (due to `verbatimModuleSyntax`): `import { Agent } from "./agent.js"`

**Path Aliases:**

- `@/*` alias for `src/` root (configured in `tsconfig.json`)
- Example: `import { Tool } from "@/tools/types.js"`

## Where to Add New Code

**New Tool:**

1. Create tool implementation in `src/tools/your-tool.ts`
2. Export from `src/tools/index.ts`
3. Register in `src/cli/main.tsx:setupTools()` function
4. Add tests in `test/tools/your-tool.test.ts`

**New LLM Provider:**

1. Create provider in `src/providers/your-provider.ts`
2. Implement `LLMClient` interface from `src/providers/types.ts`
3. Register in `src/providers/factory.ts:PROVIDER_MAP`
4. Add model detection in `src/providers/model-registry.ts`
5. Add tests in `test/providers/your-provider.test.ts`

**New CLI Command:**

1. Add handler function in `src/cli/main.tsx`
2. Add case in `main()` switch statement
3. Update help text in `showHelp()` function
4. Add tests in `test/cli/command.test.ts`

**New UI Component:**

1. Create component in `src/ui/components/YourComponent.tsx`
2. Export from `src/ui/components/index.ts`
3. Use in `src/ui/App.tsx` or other parent component
4. Add tests in `test/ui/your-component.test.tsx`

**New Utility:**

1. Create in `src/utils/your-utility.ts`
2. Export from `src/utils/index.ts` (if exists)
3. Add tests in `test/utils/your-utility.test.ts`

**New Skill:**

1. Create `SKILL.md` file in skill directory
2. Add frontmatter with `name` and `description`
3. Configure `skillDirectories` in `config.yaml`
4. Skills are auto-discovered on startup

## Special Directories

**`test/`:**

- Purpose: Test files
- Structure: Mirrors `src/` directory layout
- Contains: Unit tests, integration tests, e2e tests, security tests, performance benchmarks
- Generated: No
- Committed: Yes

**`test/e2e/`:**

- Purpose: End-to-end tests for agent loop
- Generated: No
- Committed: Yes

**`test/security/`:**

- Purpose: Security-related tests (file validation, command injection, bash env)
- Generated: No
- Committed: Yes

**`test/performance/`:**

- Purpose: Performance benchmarks
- Generated: No
- Committed: Yes

**`scripts/ralph/`:**

- Purpose: PRD and planning documents for Ralph autonomous agent
- Generated: Yes (from planning sessions)
- Committed: Yes
- Subdirs: `archive/` for historical plans

**`.planning/codebase/`:**

- Purpose: Generated architecture and structure documentation
- Generated: Yes (by `/gsd-map-codebase` command)
- Committed: No (gitignored)
- Contains: This file, ARCHITECTURE.md, STACK.md, CONVENTIONS.md, etc.

**`node_modules/` (not committed):**

- Purpose: Dependencies
- Generated: Yes (`bun install`)
- Committed: No (.gitignored)

---

_Structure analysis: 2026-01-25_
