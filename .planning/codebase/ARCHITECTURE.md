# Architecture

**Analysis Date:** 2026-01-25

## Pattern Overview

**Overall:** LLM Agent with Tool Calling Architecture

**Key Characteristics:**
- Iterative agent loop pattern where the LLM reasons, calls tools, and receives results
- Pluggable tool system via `ToolRegistry` that supports built-in and MCP tools
- Multi-provider LLM support with automatic model-to-provider detection
- Memory-augmented context management with token budgeting
- Dual output mode: CLI (plain text) and Ink (React for CLI)

## Layers

**CLI Layer (`src/cli/`):**
- Purpose: Entry point and command router
- Location: `src/cli/main.tsx`
- Contains: Command handlers (run, chat, config, status, memory, skill, mcp), argument parsing, output formatting
- Depends on: Agent, ToolRegistry, Config
- Used by: Terminal users and scripts

**Agent Layer (`src/core/`):**
- Purpose: Orchestrates the agent loop
- Location: `src/core/agent.ts`
- Contains: Agent class with `runStream()` method, iteration management, loop detection
- Depends on: LLMClient, ToolRegistry, MemoryStore, ConversationManager, Skills
- Used by: CLI handlers

**Provider Layer (`src/providers/`):**
- Purpose: Abstract LLM API implementations
- Location: `src/providers/factory.ts`, `src/providers/openai.ts`, etc.
- Contains: LLMClient interface, provider implementations (OpenAI, Anthropic, Ollama, OpenRouter, OpenCode)
- Depends on: Provider-specific SDKs
- Used by: Agent layer

**Tool Layer (`src/tools/`):**
- Purpose: Execute actions on behalf of the agent
- Location: `src/tools/registry.ts`, `src/tools/file-tools.ts`, `src/tools/bash-tool.ts`
- Contains: Tool interface, ToolRegistry, built-in tools (file, bash, grep, glob, web search)
- Depends on: Node.js fs, child_process
- Used by: Agent, CLI

**MCP Layer (`src/mcp/`):**
- Purpose: MCP (Model Context Protocol) server integration
- Location: `src/mcp/manager.ts`, `src/mcp/client.ts`
- Contains: McpManager, McpClient, tool adapter from MCP to Tool interface
- Depends on: @modelcontextprotocol/sdk
- Used by: ToolRegistry

**Skill Layer (`src/skills/`):**
- Purpose: Load and manage reusable agent prompts
- Location: `src/skills/loader.ts`, `src/skills/parser.ts`
- Contains: Skill discovery, parsing (YAML frontmatter), embedded skills
- Used by: Agent via SkillTool

**UI Layer (`src/ui/`):**
- Purpose: React-based CLI output using Ink
- Location: `src/ui/index.ts`, `src/ui/App.tsx`
- Contains: App component, StatusLine, Message, ToolOutput components
- Used by: Interactive chat mode

**Config Layer (`src/config/`):**
- Purpose: Load and validate configuration
- Location: `src/config/loader.ts`, `src/config/schema.ts`
- Contains: Config type, YAML/JSON loading, env var interpolation, validation
- Used by: All layers

## Data Flow

**Single Prompt Flow:**

1. CLI parses arguments and loads config from `~/.tiny-agent/config.yaml`
2. `Agent` is instantiated with LLMClient and ToolRegistry
3. `Agent.runStream()` creates messages with system prompt + memory context + user prompt
4. LLMClient streams response; Agent checks for tool calls
5. If no tools → yield final response, save conversation, exit
6. If tools → yield tool executions, ToolRegistry executes each tool
7. Tool results added as `tool` role messages
8. Loop returns to step 3 with updated messages
9. Loop detection prevents infinite tool calling

**Interactive Chat Flow:**

1. CLI renders empty Ink UI immediately
2. Full initialization runs in background (Agent, ToolRegistry, MCP)
3. UI re-renders with initialized Agent
4. User input → Agent.runStream() → streaming output to UI
5. StatusLine updates with model, context usage, active tool

**Context Budgeting Flow:**

1. Agent receives `maxContextTokens` option
2. `calculateContextBudget()` splits tokens between memory (20%) and conversation (80%)
3. `buildContextWithMemory()` selects relevant memories by keyword matching + category weighting
4. Messages truncated to fit budget if needed
5. Stats returned for status line display

## Key Abstractions

**LLMClient Interface (`src/providers/types.ts`):**
- Purpose: Abstract LLM API differences
- Methods: `chat()`, `stream()`, `getCapabilities()`
- Implementations: OpenAIProvider, AnthropicProvider, OllamaProvider, OpenRouterProvider, OpenCodeProvider

**Tool Interface (`src/tools/types.ts`):**
- Purpose: Standardize tool implementations
- Properties: `name`, `description`, `parameters`, `dangerous?`, `execute()`
- Examples: `src/tools/file-tools.ts`, `src/tools/bash-tool.ts`

**ToolRegistry (`src/tools/registry.ts`):**
- Purpose: Manage tool lifecycle and execution
- Methods: `register()`, `unregister()`, `execute()`, `executeBatch()`, `toOpenAIFormat()`, `toAnthropicFormat()`
- Handles dangerous tool confirmation via handler pattern

**MemoryStore (`src/core/memory.ts`):**
- Purpose: Persist and retrieve memories across sessions
- Methods: `add()`, `findRelevant()`, `list()`, `flush()`
- Categories: user, project, codebase (with different priority multipliers)

**McpManager (`src/mcp/manager.ts`):**
- Purpose: Manage MCP server connections and adapt MCP tools to Tool interface
- Methods: `addServer()`, `callTool()`, `createToolFromMcp()`, `getServerStatus()`
- Creates wrapped tools with `mcp_${serverName}_${toolName}` naming

## Entry Points

**Primary Entry Point:**
- Location: `index.ts`
- Exports: main export from `src/cli/index.js`

**CLI Entry (`src/cli/main.tsx`):**
- Responsibilities: Parse args, route commands, setup Agent and ToolRegistry, handle output
- Commands: chat (interactive), run (single prompt), config, status, memory, skill, mcp
- Output modes: Plain text (TTY), JSON (--json), Ink (interactive)

**Repl Entry:**
- Location: `src/cli/chat-commands.ts` (when user types commands in chat)

## Error Handling

**Strategy:** Structured result objects, never throw for expected failures

**Patterns:**
- Tools return `{ success: boolean; output?: string; error?: string }`
- Agent catches tool errors and continues with error message
- CLI catches startup errors and exits with code 1
- Config validation returns array of `{ field, message }`

## Cross-Cutting Concerns

**Logging:** Console.log for verbose mode, warn for non-critical issues

**Validation:** Zod schemas for tool args (`src/tools/file-tools.ts`), config validation function (`src/config/schema.ts`)

**Authentication:** Env var interpolation in config (`${VAR_NAME}`), sensitive key warnings

**Dangerous Operations:** Tool-level dangerous flag, confirmation handler pattern, user prompts

---

*Architecture analysis: 2026-01-25*
