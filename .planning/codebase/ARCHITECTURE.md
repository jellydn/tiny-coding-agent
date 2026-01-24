# Architecture

**Analysis Date:** 2026-01-25

## Pattern Overview

**Overall:** Event-driven streaming agent architecture with provider abstraction layer

**Key Characteristics:**
- **Async streaming first**: Agent uses `AsyncGenerator` pattern for streaming responses and tool executions
- **Provider abstraction**: Multiple LLM providers (OpenAI, Anthropic, Ollama, OpenRouter, OpenCode) via factory pattern
- **Tool registry pattern**: Centralized tool registration and execution with confirmation handling
- **Modular plugin system**: MCP servers, custom plugins, and skill loading as extensibility points
- **Context management**: MemoryStore for persistent context, token budgeting, and message truncation

## Layers

**CLI Layer:**
- Purpose: Entry point, command routing, and user interface
- Location: `src/cli/`
- Contains: Command handlers, argument parsing, output formatting (Ink/React or plain text)
- Depends on: Config loader, ToolRegistry, Agent
- Used by: End users via CLI commands

**Agent Layer:**
- Purpose: Orchestrate LLM interactions, tool execution, and context management
- Location: `src/core/`
- Contains: `Agent.ts` (main orchestrator), `MemoryStore.ts` (persistent context), `ConversationManager.ts` (session history), `tokens.ts` (token counting)
- Depends on: LLMClient, ToolRegistry, Config, Skills
- Used by: CLI layer for all agent operations

**Tool Layer:**
- Purpose: Provide capabilities to the agent via a registry
- Location: `src/tools/`
- Contains: `ToolRegistry.ts`, built-in tools (file, bash, grep, glob, web search), plugin loader
- Depends on: Tool interface definition
- Used by: Agent layer for tool execution

**Provider Layer:**
- Purpose: Abstract LLM API differences behind a common interface
- Location: `src/providers/`
- Contains: Factory, provider implementations (OpenAI, Anthropic, Ollama, OpenRouter, OpenCode), type definitions
- Depends on: External SDKs (@anthropic-ai/sdk, openai, ollama)
- Used by: Agent layer for LLM communication

**MCP Integration Layer:**
- Purpose: Integrate with Model Context Protocol servers for extended capabilities
- Location: `src/mcp/`
- Contains: `McpManager.ts` (server lifecycle), `McpClient.ts` (transport), type definitions
- Depends on: `@modelcontextprotocol/sdk`
- Used by: CLI layer to register MCP tools into ToolRegistry

**Skills Layer:**
- Purpose: Load and manage agent skills (prompt templates with metadata)
- Location: `src/skills/`
- Contains: Skill discovery, parsing, loading, and prompt generation
- Used by: Agent layer to inject skill prompts into system message

**Config Layer:**
- Purpose: Load and validate configuration
- Location: `src/config/`
- Contains: `Config` schema, YAML loader, validation
- Depends on: yaml package
- Used by: All layers for configuration

**UI Layer:**
- Purpose: Interactive chat interface using Ink (React for CLI)
- Location: `src/ui/`
- Contains: React components, contexts, state management
- Used by: CLI interactive chat mode

## Data Flow

**Agent Execution Flow:**

1. CLI receives user input and options (`src/cli/main.tsx`)
2. Config is loaded (`src/config/loader.ts`)
3. ToolRegistry is populated with built-in tools, plugins, and MCP tools
4. Agent is instantiated with LLM client and registry
5. `Agent.runStream()` is called with user prompt
6. Agent prepares context:
   - Loads conversation history
   - Retrieves relevant memories (if memory enabled)
   - Calculates token budgets
   - Truncates if needed
7. Agent sends request to LLM client (`src/providers/factory.ts`)
8. LLM responds with streaming chunks containing:
   - Content fragments (filtered for `<thinking>` tags)
   - Tool calls
9. For each tool call:
   - Agent yields execution status to consumer
   - ToolRegistry executes tool with confirmation handling
   - Results are sent back to LLM
10. Loop continues until LLM responds without tool calls
11. Agent yields final response and updates conversation history
12. Memory is saved (if enabled)

**State Management:**
- **Conversation**: Managed by `ConversationManager` with optional file persistence
- **Memory**: `MemoryStore` with JSON file persistence, category-based (user/project/codebase)
- **Context Budgeting**: Token-based budgeting with system prompt priority, memory budget (20%), conversation budget (80%)
- **Tool Restrictions**: Skills can restrict which tools are available via `_setSkillRestriction()`

## Key Abstractions

**LLMClient Interface:**
- Purpose: Abstract provider-specific API differences
- Location: `src/providers/types.ts`
- Interface:
  ```typescript
  interface LLMClient {
    chat(options: ChatOptions): Promise<ChatResponse>;
    stream(options: ChatOptions): AsyncGenerator<StreamChunk, void, unknown>;
    getCapabilities(model: string): Promise<ModelCapabilities>;
  }
  ```
- Implementations: `OpenAIProvider`, `AnthropicProvider`, `OllamaProvider`, `OllamaCloudProvider`, `OpenRouterProvider`, `OpenCodeProvider`

**Tool Interface:**
- Purpose: Define tool contract for the agent
- Location: `src/tools/types.ts`
- Interface:
  ```typescript
  interface Tool {
    name: string;
    description: string;
    parameters: ToolParameters;
    dangerous?: ToolDangerLevel;
    execute(args: Record<string, unknown>): Promise<ToolResult>;
  }
  ```

**ToolRegistry:**
- Purpose: Central registry for tool management and batch execution with confirmation
- Location: `src/tools/registry.ts`
- Key methods: `register()`, `executeBatch()`, `toOpenAIFormat()`, `toAnthropicFormat()`

**McpManager:**
- Purpose: Manage MCP server lifecycle and tool registration
- Location: `src/mcp/manager.ts`
- Key methods: `addServer()`, `getAllTools()`, `createToolFromMcp()`, `getServerStatus()`

## Entry Points

**Primary Entry Point:**
- Location: `index.ts`
- Triggers: `bun run dev`, `bun run start`, or direct execution
- Responsibilities: Import and call `main()` from CLI, handle fatal errors

**CLI Entry Point:**
- Location: `src/cli/main.tsx`
- Triggers: CLI command execution
- Responsibilities: Parse arguments, route to handlers, handle errors

**Command Handlers:**
- `handleInteractiveChat()`: Interactive REPL mode with Ink UI
- `handleRun()`: Single prompt execution with streaming output
- `handleConfig()`: Display/edit configuration
- `handleStatus()`: Show provider and model capabilities
- `handleMemory()`: Manage persistent memories
- `handleSkill()`: Manage agent skills
- `handleMcp()`: Manage MCP servers

**Agent Entry Point:**
- Location: `src/core/agent.ts` - `Agent.runStream()`
- Triggers: CLI handlers
- Responsibilities: Execute agent loop with LLM and tools

## Error Handling

**Strategy:** Structured result objects, not exceptions for expected failures

**Patterns:**
- Tool execution returns `{ success: boolean; output?: string; error?: string }`
- Agent responses use `AgentStreamChunk` with `done` flag
- Config validation returns array of `ConfigValidationError`
- Specific error codes: `ENOENT` (file not found), `EACCES` (permission denied)

**Confirmation Flow:**
- Dangerous tools require user confirmation via callback
- `ToolRegistry.executeBatch()` filters dangerous calls
- Confirmation handler returns: `true` (all approved), `false` (all declined), or `{ type: "partial", selectedIndex }`

## Cross-Cutting Concerns

**Logging:**
- Verbose mode controlled by `--verbose` flag
- Uses `console.log()` for output
- Conditional logging throughout agent loop

**Validation:**
- Config schema in `src/config/schema.ts`
- Zod for type validation (not actively used in current code)
- Tool parameters defined as JSON Schema objects

**Authentication:**
- API keys from environment variables or config file
- Provider factory validates required credentials
- Key redaction in verbose output (`key.slice(0,4)...key.slice(-4)`)

**Streaming:**
- All LLM responses streamed via `AsyncGenerator`
- Thinking tags filtered from output
- Token counting sync (`countTokensSync`) for budgeting decisions

---

*Architecture analysis: 2026-01-25*
