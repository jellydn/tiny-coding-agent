# Architecture

**Analysis Date:** 2026-01-25

## Pattern Overview

**Overall:** Event-Driven Tool-Augmented Agent Pattern

The tiny-agent codebase implements an agent architecture where a central `Agent` class orchestrates interactions between:

1. An LLM provider (for text generation and tool calling)
2. A tool registry (for executing filesystem, shell, and search operations)
3. Optional memory stores (for persistent context across sessions)
4. Optional MCP servers (for extended capabilities)

**Key Characteristics:**

- **Async Generator Streaming:** The agent uses async generators (`runStream`) to yield chunks progressively, enabling real-time output streaming
- **Tool Registry Pattern:** All tools are registered via `ToolRegistry` class, which handles execution, dangerous command confirmation, and format conversion (OpenAI/Anthropic)
- **Provider Factory Pattern:** LLM clients are created via factory function based on model name detection
- **Memory-Enhanced Context:** Optional long-term memory with token budgeting and relevance-based retrieval
- **MCP Integration:** MCP servers are dynamically discovered and their tools wrapped with prefix naming (`mcp_servername_toolname`)

## Layers

**CLI/Entry Layer:**

- Purpose: Parse command-line arguments, route to appropriate handlers
- Location: `src/cli/main.tsx`
- Contains: `main()` function, handlers for commands (`run`, `chat`, `status`, `config`, `memory`, `skill`, `mcp`)
- Used by: Direct execution via `index.ts`

**Core Agent Layer:**

- Purpose: Orchestrate the agent loop, manage context, handle tool execution
- Location: `src/core/agent.ts`
- Contains: `Agent` class with `runStream()` async generator, memory integration, skill loading
- Depends on: `LLMClient`, `ToolRegistry`, `MemoryStore`, `ConversationManager`
- Used by: CLI handlers, tests

**Tool Layer:**

- Purpose: Execute operations (filesystem, shell, search, web)
- Location: `src/tools/`
- Contains: `ToolRegistry`, `Tool` interface, individual tools (`file-tools.ts`, `bash-tool.ts`, `search-tools.ts`, etc.)
- Depends on: Node.js `fs/promises`, external APIs for web search
- Used by: `Agent` via `ToolRegistry.executeBatch()`

**Provider Layer:**

- Purpose: Abstract LLM API differences behind unified `LLMClient` interface
- Location: `src/providers/`
- Contains: Provider implementations (`openai.ts`, `anthropic.ts`, `ollama.ts`, `openrouter.ts`, `opencode.ts`), factory (`factory.ts`)
- Depends on: External SDKs (`openai`, `@anthropic-ai/sdk`, `ollama`)
- Used by: `Agent` and CLI handlers

**Memory Layer:**

- Purpose: Persistent long-term memory across sessions with token budgeting
- Location: `src/core/memory.ts`
- Contains: `MemoryStore` class with file persistence, relevance scoring, LRU eviction
- Used by: `Agent` for context enhancement

**MCP Integration Layer:**

- Purpose: Connect to Model Context Protocol servers for extended tool sets
- Location: `src/mcp/`
- Contains: `McpManager` class, `McpClient` class, types
- Used by: CLI setup in `main.tsx`

**Skills Layer:**

- Purpose: Discover and load agent skills (reusable prompt templates)
- Location: `src/skills/`
- Contains: `Skill` types, discovery, parsing, loading, embedded registry
- Used by: `Agent` during initialization, `skill-tool.ts` for runtime loading

**Configuration Layer:**

- Purpose: Load and validate configuration from YAML/JSON files
- Location: `src/config/`
- Contains: `loadConfig()`, schema validation, env var interpolation
- Used by: All layers that need configuration

**UI Layer:**

- Purpose: Render interactive CLI with React/Ink
- Location: `src/ui/`
- Contains: `App` component, status line manager, tool output components
- Used by: Interactive chat mode in `main.tsx`

## Data Flow

**Single Prompt Flow:**

1. **CLI parses args** → `src/cli/main.tsx:handleRun()`
2. **Load config** → `src/config/loader.ts:loadConfig()`
3. **Create LLM client** → `src/providers/factory.ts:createProvider()`
4. **Setup tool registry** → `src/cli/main.tsx:setupTools()`
   - Registers built-in tools (file, bash, grep, glob, web search)
   - Loads plugins from `~/.tiny-agent/plugins/`
   - Connects MCP servers and registers their tools
5. **Create Agent** → `src/core/agent.ts:Agent` constructor
   - Initializes memory store if configured
   - Discovers skills from configured directories
   - Builds system prompt with skills prompt
6. **Stream execution** → `agent.runStream(userPrompt, model)`
   - Builds context (memory + conversation + system)
   - Streams to LLM client
   - Yields content chunks + tool execution updates
   - Executes tools via registry
   - Loops until LLM returns no tool calls
7. **Output** → CLI renders to stdout (plain or Ink UI)

**Interactive Chat Flow:**

1. Same steps 1-5 as Single Prompt
2. **Render React app** → `src/ui/index.ts:renderApp()`
3. **User types message** → React state updates
4. **Agent runs** → Same step 6 as Single Prompt
5. **Update UI** → Status line, tool output, assistant response
6. **Loop** → Back to step 3

**Memory Retrieval Flow:**

1. `Agent` receives user prompt
2. `MemoryStore.findRelevant(query, maxResults)` called
3. Scores memories by keyword match × category multiplier × access frequency
4. Returns top N memories sorted by score
5. Memories inserted into system prompt as `## Relevant Memories` section
6. Token budget enforced: memory context limited to 20% of available content tokens

**State Management:**

- **Conversation State:** Managed by `ConversationManager`, persists to JSON file if configured
- **Memory State:** `MemoryStore` persists to JSON with debounced writes (100ms)
- **Agent State:** In-memory only during execution, no persistence between runs
- **MCP State:** Maintained by `McpManager`, connections persist for session lifetime

## Key Abstractions

**Tool Interface:**

```typescript
// src/tools/types.ts
interface Tool {
  name: string;
  description: string;
  parameters: ToolParameters;
  dangerous?: ToolDangerLevel;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}
```

- Purpose: Unified interface for all tool operations
- Examples: `readFileTool` (`src/tools/file-tools.ts`), `bashTool` (`src/tools/bash-tool.ts`), `grepTool` (`src/tools/search-tools.ts`)

**LLMClient Interface:**

```typescript
// src/providers/types.ts
interface LLMClient {
  chat(options: ChatOptions): Promise<ChatResponse>;
  stream(options: ChatOptions): AsyncGenerator<StreamChunk, void, unknown>;
  getCapabilities(model: string): Promise<ModelCapabilities>;
}
```

- Purpose: Abstract different LLM APIs behind unified streaming interface
- Examples: `OpenAIProvider` (`src/providers/openai.ts`), `AnthropicProvider` (`src/providers/anthropic.ts`), `OllamaProvider` (`src/providers/ollama.ts`)

**ToolRegistry Class:**

```typescript
// src/tools/registry.ts
class ToolRegistry {
  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  list(): Tool[];
  execute(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  executeBatch(calls: Array<{name: string; args: Record<string, unknown>}>): Promise<...>;
  toOpenAIFormat(): OpenAIFunctionDef[];
  toAnthropicFormat(): AnthropicToolDef[];
}
```

- Purpose: Central registry for all available tools, handles batch execution and format conversion
- Used by: `Agent` to get tool definitions and execute tools

**MemoryStore Class:**

```typescript
// src/core/memory.ts
class MemoryStore {
  add(content: string, category?: MemoryCategory): Memory;
  findRelevant(query: string, maxResults?: number): Memory[];
  list(): Memory[];
  countTokens(): number;
  flush(): Promise<void>;
}
```

- Purpose: Persistent memory with relevance scoring, token budgeting, and LRU eviction
- Used by: `Agent` for context enhancement

## Entry Points

**Primary Entry Point:**

- Location: `index.ts`
- Triggers: `bun run dev` or direct execution of compiled binary
- Responsibilities: Import and invoke `main()` from CLI, handle fatal errors with exit code 1

**CLI Main:**

- Location: `src/cli/main.tsx`
- Triggers: Called from `index.ts`
- Responsibilities: Parse args, route to subcommands, setup Agent and run
- Key handlers:
  - `handleRun()` - Single prompt execution
  - `handleInteractiveChat()` - Interactive REPL mode
  - `handleStatus()` - Show provider/capabilities
  - `handleMemory()` - Memory management
  - `handleSkill()` - Skill management
  - `handleMcp()` - MCP server management

**Agent Stream:**

- Location: `src/core/agent.ts:Agent.runStream()`
- Triggers: Called by CLI handlers or tests
- Responsibilities: Main agent loop, context management, tool execution orchestration
- Returns: `AsyncGenerator<AgentStreamChunk>` for streaming output

## Error Handling

**Strategy:** Return-value based errors (not exceptions) for expected failures

**Patterns:**

- Tools return `{ success: boolean; output?: string; error?: string }` structure
- Provider methods return typed responses with `finishReason` field
- Configuration validation returns array of `ConfigValidationError` objects
- File operations catch Node.js errors and return structured tool results with `code` property (`ENOENT`, `EACCES`, `EISDIR`, `ENOTDIR`)

**Loop Detection:**

- `isLooping()` function in `src/core/agent.ts` detects:
  - Same tool called 3+ times identically
  - Same tool family called 5+ times
  - Any tool called 8+ times in last 10 calls

## Cross-Cutting Concerns

**Logging:**

- Verbose mode controlled via `verbose` option
- Console.log for debugging output (wrapped in `if (this._verbose)` checks)
- No centralized logging framework

**Validation:**

- Zod for argument validation in tools (e.g., `src/tools/file-tools.ts`)
- Config schema validation in `src/config/schema.ts`
- Path validation in `src/tools/file-tools.ts` for security

**Authentication:**

- Environment variable interpolation in config (`${VAR_NAME}` syntax)
- API keys passed via provider config objects
- No credential persistence in code

**Security:**

- `.env` files blocked from reading by file tools
- Path traversal prevention in file operations
- Dangerous tool confirmation prompts via `getConfirmationHandler()`
- MCP tool prefixing (`mcp_servername_toolname`) to avoid conflicts

---

_Architecture analysis: 2026-01-25_
