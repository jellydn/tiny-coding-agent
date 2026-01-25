# Codebase Structure

**Analysis Date:** 2026-01-25

## Directory Layout

```
tiny-agent/
├── src/
│   ├── cli/              # CLI entry points and command handlers
│   ├── core/             # Agent loop and state management
│   ├── tools/            # Built-in tools and registry
│   ├── providers/        # LLM provider implementations
│   ├── mcp/              # MCP server integration
│   ├── skills/           # Skill loading and management
│   ├── ui/               # Ink React components for CLI
│   ├── config/           # Configuration loading and schema
│   └── utils/            # Shared utilities
├── test/                 # Test fixtures and e2e tests
├── tasks/                # Task definitions for the agent
├── scripts/              # Build and utility scripts
├── docs/                 # Documentation
├── index.ts              # Primary entry point
├── tsconfig.json         # TypeScript configuration
└── package.json          # Dependencies
```

## Directory Purposes

**`src/cli/`:**
- Purpose: CLI interface and command routing
- Contains: `main.tsx` (1360+ lines - main CLI logic), `index.ts` (reexports), `chat-commands.ts`, `status-line.ts`
- Key files:
  - `main.tsx`: Command handlers (handleRun, handleChat, handleConfig, handleStatus, handleMemory, handleSkill, handleMcp)
  - `status-line.ts`: Status line component for Ink

**`src/core/`:**
- Purpose: Agent orchestration and state
- Contains: `agent.ts` (main Agent class), `memory.ts` (MemoryStore), `conversation.ts` (ConversationManager), `tokens.ts` (token counting)
- Key files:
  - `agent.ts`: Agent loop, loop detection, streaming response
  - `memory.ts`: Memory persistence, context budgeting, relevance scoring
  - `conversation.ts`: Conversation history management
  - `tokens.ts`: Token counting utilities

**`src/tools/`:**
- Purpose: Built-in tools and tool registry
- Contains: `registry.ts` (ToolRegistry), `file-tools.ts` (file operations), `bash-tool.ts` (shell `search-tools.ts),` (grep, glob), `web-search-tool.ts`, `skill-tool.ts`
- Key files:
  - `registry.ts`: Tool registration, execution, format conversion (OpenAI/Anthropic)
  - `file-tools.ts`: read_file, write_file, edit_file, list_directory with validation
  - `bash-tool.ts`: Command execution with output capture
  - `search-tools.ts`: grep and glob search tools

**`src/providers/`:**
- Purpose: LLM provider implementations
- Contains: `factory.ts` (provider creation), `openai.ts`, `anthropic.ts`, `ollama.ts`, `ollama-cloud.ts`, `openrouter.ts`, `opencode.ts`, `types.ts`
- Key files:
  - `factory.ts`: createProvider(), detectProvider(), provider mapping
  - `types.ts`: LLMClient interface, Message, ToolCall, ChatOptions
  - `capabilities.ts`: Model capabilities detection

**`src/mcp/`:**
- Purpose: MCP (Model Context Protocol) integration
- Contains: `manager.ts` (McpManager), `client.ts` (McpClient), `types.ts`
- Key files:
  - `manager.ts`: Server management, tool adaptation, global singleton (deprecated)
  - `client.ts`: MCP protocol communication

**`src/skills/`:**
- Purpose: Skill discovery and loading
- Contains: `loader.ts` (skill discovery), `parser.ts` (YAML frontmatter), `prompt.ts` (prompt generation), `builtin-registry.ts` (embedded skills)
- Key files:
  - `loader.ts`: discoverSkills(), getBuiltinSkillsDir()
  - `parser.ts`: parseSkillFrontmatter() for YAML frontmatter parsing

**`src/ui/`:**
- Purpose: Ink React components for interactive CLI
- Contains: `App.tsx`, `components/` (StatusLine, Message, ToolOutput, ToastList), `contexts/` (StatusLineContext, ChatContext, ToastContext)
- Key files:
  - `App.tsx`: Main interactive app component
  - `components/`: Reusable UI components
  - `contexts/`: React contexts for state management
  - `status-line-manager.ts`: Singleton for status updates

**`src/config/`:**
- Purpose: Configuration loading and validation
- Contains: `loader.ts` (config loading), `schema.ts` (Config type, validation)
- Key files:
  - `loader.ts`: loadConfig(), loadAgentsMd(), env var interpolation
  - `schema.ts`: Config interface, validateConfig()

**`src/utils/`:**
- Purpose: Shared utility functions
- Contains: `command.ts` (command availability check), `retry.ts`, `xml.ts` (XML escaping)
- Key files:
  - `command.ts`: isCommandAvailable()
  - `retry.ts`: Retry logic decorators

## Key File Locations

**Entry Points:**
- `index.ts`: Primary entry, exports from `src/cli/index.js`
- `src/cli/main.tsx`: CLI command router and handlers (1360+ lines)

**Configuration:**
- `src/config/loader.ts`: Config loading with YAML/JSON support
- `src/config/schema.ts`: Type definitions and validation

**Core Logic:**
- `src/core/agent.ts`: Main Agent class with streaming loop
- `src/core/memory.ts`: MemoryStore with context budgeting
- `src/tools/registry.ts`: ToolRegistry for tool management

**Testing:**
- `test/`: Test fixtures and e2e tests
- `src/**/*.test.ts`: Unit tests (e.g., `src/core/agent.test.ts`)

## Naming Conventions

**Files:**
- kebab-case: `file-tools.ts`, `bash-tool.ts`, `status-line.ts`
- PascalCase for components: `StatusLine.tsx`, `Message.tsx`, `App.tsx`
- camelCase for utilities: `command.ts`, `retry.ts`, `xml.ts`

**Directories:**
- kebab-case: `cli/`, `core/`, `tools/`, `providers/`, `mcp/`, `skills/`, `ui/`, `config/`, `utils/`

**Classes/Types:**
- PascalCase: `Agent`, `ToolRegistry`, `MemoryStore`, `ConversationManager`, `McpManager`

**Functions/Variables:**
- camelCase: `runStream`, `executeBatch`, `findRelevant`, `createProvider`

**Constants:**
- SCREAMING_SNAKE_CASE: `MAX_OUTPUT_LENGTH`, `SAVE_DEBOUNCE_MS`, `YAML_PATH`

**Private Members:**
- _prefix: `_tools`, `_maxIterations`, `_providerCache`, `_memoryStore`

## Where to Add New Code

**New Built-in Tool:**
- Implementation: `src/tools/new-tool-name.ts`
- Export: Add to `src/tools/index.ts` exports
- Register in: `src/cli/main.tsx` `setupTools()` function

**New LLM Provider:**
- Implementation: `src/providers/new-provider.ts`
- Export: Add to `src/providers/index.ts`
- Register in: `src/providers/factory.ts` PROVIDER_MAP, `src/providers/model-registry.ts`

**New CLI Command:**
- Implementation: Add handler function in `src/cli/main.tsx`
- Register in: `main()` function command routing
- Export: Add to `src/cli/index.ts` if needed

**New UI Component:**
- Implementation: `src/ui/components/NewComponent.tsx`
- Export: Add to `src/ui/components/index.ts`

**New Utility:**
- Implementation: `src/utils/utility-name.ts`
- Export: Add to barrel exports as needed

**New Skill:**
- Location: `~/.tiny-agent/skills/skill-name/SKILL.md` (user) or `src/skills/builtin/skill-name/` (builtin)
- Format: Markdown with YAML frontmatter

## Special Directories

**`src/skills/builtin/`:**
- Purpose: Embedded skills bundled with the agent
- Generated: Yes, via `bun run generate:skills`
- Committed: Yes, as generated TypeScript file

**`test/`:**
- Purpose: Test fixtures and end-to-end tests
- Generated: No
- Committed: Yes

**`tasks/`:**
- Purpose: Task definitions for the agent to execute
- Generated: No
- Committed: Yes

**`.planning/codebase/`:**
- Purpose: Architecture documentation (this file)
- Generated: No (created by GSD mapping)
- Committed: Optionally

---

*Structure analysis: 2026-01-25*
