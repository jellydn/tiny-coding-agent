# Codebase Structure

**Analysis Date:** 2026-01-25

## Directory Layout

```
tiny-coding-agent/
├── src/
│   ├── cli/              # CLI entry point and command handlers
│   ├── core/             # Agent orchestration and state
│   ├── tools/            # Built-in tools and registry
│   ├── providers/        # LLM client implementations
│   ├── mcp/              # MCP integration layer
│   ├── skills/           # Skill loading and management
│   ├── config/           # Configuration loading
│   ├── ui/               # Interactive UI (Ink/React)
│   └── utils/            # Utilities (XML, command helpers)
├── test/                 # Test files
├── tasks/                # Task definitions
├── docs/                 # Documentation
├── scripts/              # Build/deployment scripts
├── index.ts              # Primary entry point
└── tsconfig.json         # TypeScript configuration
```

## Directory Purposes

**cli/**

- Purpose: Command-line interface and command handlers
- Contains: Main entry point, argument parsing, command routing, interactive UI setup
- Key files:
  - `main.tsx` (1358 lines): Main CLI logic with all command handlers
  - `index.ts`: Re-exports for CLI module
  - `status-line.ts`: Status line rendering utilities

**core/**

- Purpose: Agent loop, memory management, token handling
- Contains: Agent orchestrator, persistent memory store, conversation history
- Key files:
  - `agent.ts` (721 lines): Main Agent class with streaming execution
  - `memory.ts` (337 lines): MemoryStore for persistent context
  - `conversation.ts`: Conversation history management
  - `tokens.ts`: Token counting utilities
  - `index.ts`: Barrel exports

**tools/**

- Purpose: Built-in tool implementations and registry
- Contains: File I/O, bash execution, search tools, plugin loader
- Key files:
  - `registry.ts` (156 lines): ToolRegistry class for tool management
  - `file-tools.ts`: File read/write/edit tools
  - `bash-tool.ts`: Bash execution tool
  - `search-tools.ts`: grep and glob tools
  - `web-search-tool.ts`: Web search capability
  - `plugin-loader.ts`: Dynamic plugin loading
  - `skill-tool.ts`: Skill loading tool
  - `types.ts`: Tool interface definitions
  - `index.ts`: Barrel exports

**providers/**

- Purpose: LLM client implementations
- Contains: Provider factory, individual provider implementations
- Key files:
  - `factory.ts` (97 lines): createProvider() factory function
  - `types.ts`: LLMClient interface and message types
  - `openai.ts`: OpenAI provider
  - `anthropic.ts`: Anthropic provider
  - `ollama.ts`: Local Ollama provider
  - `ollama-cloud.ts`: Ollama Cloud provider
  - `openrouter.ts`: OpenRouter provider
  - `opencode.ts`: OpenCode provider
  - `capabilities.ts`: Model capabilities detection
  - `model-registry.ts`: Model-to-provider detection
  - `index.ts`: Barrel exports

**mcp/**

- Purpose: Model Context Protocol integration
- Contains: MCP client, server manager, type definitions
- Key files:
  - `manager.ts`: McpManager for server lifecycle
  - `client.ts`: McpClient transport layer
  - `types.ts`: MCP type definitions
  - `index.ts`: Barrel exports

**skills/**

- Purpose: Agent skill management
- Contains: Skill discovery, parsing, loading, prompt generation
- Key files:
  - `loader.ts`: Skill discovery from directories
  - `parser.ts`: YAML frontmatter parsing
  - `prompt.ts`: Skills prompt generation
  - `builtin-registry.ts`: Embedded skill content
  - `types.ts`: Skill type definitions
  - `index.ts`: Barrel exports

**config/**

- Purpose: Configuration loading and validation
- Contains: Config schema, YAML loader, validation
- Key files:
  - `schema.ts` (157 lines): Config interfaces and validation
  - `loader.ts`: YAML config file loader
  - `index.ts`: Barrel exports

**ui/**

- Purpose: Interactive CLI UI using Ink (React)
- Contains: React components, contexts, state management
- Key files:
  - `App.tsx`: Main chat application component
  - `components/`: Reusable UI components
  - `contexts/`: React contexts (StatusLine, Chat)
  - `status-line-manager.ts`: Non-React status line state
  - `index.ts`: Barrel exports

**utils/**

- Purpose: Shared utility functions
- Contains: XML escaping, command availability checking
- Key files:
  - `xml.ts`: XML escape/unescape utilities
  - `command.ts`: Command availability helpers

## Key File Locations

**Entry Points:**

- `index.ts`: Main entry point that imports and runs CLI main
- `src/cli/main.tsx`: CLI main function with all command handlers
- `src/cli/index.ts`: CLI module exports

**Configuration:**

- `src/config/schema.ts`: Config type definitions
- `src/config/loader.ts`: Config file loading (~50 lines)
- `~/.tiny-agent/config.yaml`: User config file location

**Core Logic:**

- `src/core/agent.ts`: Agent class with runStream() method
- `src/tools/registry.ts`: ToolRegistry class
- `src/providers/factory.ts`: Provider factory function

**Testing:**

- `test/core/memory.test.ts`: Memory store tests
- `test/tools/file-tools.test.ts`: File tool tests
- `test/` directory follows same structure as `src/`

## Naming Conventions

**Files:**

- `kebab-case.ts`: Module files (e.g., `file-tools.ts`, `bash-tool.ts`)
- `PascalCase.tsx`: React components (e.g., `App.tsx`, `ToolOutput.tsx`)
- `kebab-case.test.ts`: Test files (e.g., `memory.test.ts`)

**Directories:**

- `lowercase/`: All directories use lowercase (e.g., `cli`, `core`, `tools`)

**Types and Classes:**

- `PascalCase`: Classes and interfaces (e.g., `Agent`, `ToolRegistry`, `MemoryStore`)
- `camelCase`: Functions and variables (e.g., `createProvider`, `loadConfig`)

**Constants:**

- `SCREAMING_SNAKE_CASE`: Constants (e.g., `MAX_OUTPUT_LENGTH`, `SAVE_DEBOUNCE_MS`)

**Private Members:**

- `_prefix`: Private class members (e.g., `_tools`, `_maxIterations`, `_systemPrompt`)

**Exports:**

- Barrel files (`index.ts`) re-export from modules
- Type exports use `export type { ... }` for type-only imports

## Where to Add New Code

**New Built-in Tool:**

- Implementation: `src/tools/[tool-name].ts`
- Export from: `src/tools/index.ts`
- Register in: `src/cli/main.tsx` `setupTools()` function

**New LLM Provider:**

- Implementation: `src/providers/[provider-name].ts`
- Export from: `src/providers/index.ts`
- Add factory case in: `src/providers/factory.ts`
- Add model detection in: `src/providers/model-registry.ts`
- Add config type in: `src/config/schema.ts`

**New CLI Command:**

- Handler function in: `src/cli/main.tsx`
- Add command routing in: `main()` function
- Add help text in: `showHelp()` function

**New Skill:**

- Location: `~/.tiny-agent/skills/[skill-name]/SKILL.md`
- Or add to configured `skillDirectories` in config

**New Config Option:**

- Add type in: `src/config/schema.ts`
- Add validation in: `validateConfig()`
- Add loader in: `src/config/loader.ts`
- Use in: `src/cli/main.tsx`

**New UI Component:**

- Component file: `src/ui/components/[ComponentName].tsx`
- Export from: `src/ui/components/index.ts`
- Use in: `src/ui/App.tsx` or other components

**New Utility:**

- Utility file: `src/utils/[utility-name].ts`
- Export from: `src/utils/index.ts` (create if needed)

## Special Directories

**.planning/codebase/**

- Purpose: Architecture and planning documents
- Generated: Yes
- Committed: Yes (for GSD phase consumption)

**node_modules/**

- Purpose: Dependencies
- Generated: Yes (by bun)
- Committed: No (in .gitignore)

**test/**

- Purpose: Test files mirroring src structure
- Generated: No
- Committed: Yes

**tasks/**

- Purpose: Task definitions (possibly for AI planning)
- Generated: No
- Committed: Yes

**scripts/**

- Purpose: Build and deployment scripts
- Generated: No
- Committed: Yes

**docs/**

- Purpose: Documentation files
- Generated: No
- Committed: Yes

---

_Structure analysis: 2026-01-25_
