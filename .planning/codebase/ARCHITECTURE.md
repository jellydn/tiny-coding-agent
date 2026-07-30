# Architecture

## System Layers

```
User (CLI or Chat)
    │
    ▼
┌─────────────────────┐
│    CLI Layer        │  main.tsx → command-dispatch → handlers
│  (Ink React UI)     │
└─────────┬───────────┘
          │
┌─────────▼───────────┐
│   Agent Loop        │  Agent.runStream() → LLM calls → Tool execution
│  (Core Harness)     │
└─────────┬───────────┘
          │
┌─────────▼───────────┐
│   Provider Layer    │  LLMClient abstraction — 10+ providers
│  (API clients)      │
└─────────┬───────────┘
          │
┌─────────▼───────────┐
│   Tool System       │  ToolRegistry → Bash, File, Search, MCP
│  (Execution)        │
└─────────────────────┘
```

## Key Design Patterns

### 1. Provider Abstraction
- Common `LLMClient` interface in `src/providers/types.ts`
- `ProviderCache` manages client instances with LRU eviction
- `ToolDefinition` and `Message` types are shared across providers
- `detectProvider()` maps model strings to provider implementations

### 2. Agent Loop (runStream)
- Async generator yielding `AgentStreamChunk` objects
- Each iteration: stream LLM response → collect tool calls → execute tools → append results → repeat
- Loop detection via `isLooping()` in agent-utils.ts
- Context budgeting via `prepareContext()` and `buildContextStats()` in context-budget.ts
- Skill system prompt augmentation via SkillManager

### 3. Tool System
- `ToolRegistry` — central registry with dry-run mode and dangerous-tool confirmation
- `TurnExecutor` — executes one iteration's tool calls, handles retry/skip/abort
- Confirmation system for dangerous operations (write, edit, delete, bash-destructive)
- Tools can be registered statically (file-tools, bash) or dynamically (MCP servers)

### 4. Memory System
- `MemoryStore` — in-memory with file persistence, LRU eviction by count or tokens
- `SignalHandlerManager` — flushes stores on SIGTERM/SIGINT
- Memories are injected into context via `prepareContext()` in context-budget.ts

### 5. CLI / Ink UI
- `main.tsx` — entry point with command parsing and Ink-based rendering
- Chat mode uses Ink React components: ChatLayout, MessageList, ModelPicker, etc.
- `command-dispatch.ts` — centralized command routing
- Help text in `help-text.ts`

### 6. Hooks System
- Lifecycle hooks (e.g. plannotator) for pre-build/pre-execute workflows
- Hook registry and execution in `src/hooks/`

## Module Depth (ADR-016)
The codebase has undergone 5 rounds of architecture deepening (14 extractions):
- Agent decomposed into: agent-utils, context-budget, debug-logger, provider-cache, skill-manager, turn-executor, agent-observability
- CLI decomposed into: command-dispatch, tool-display, chat-command-registry, help-text
- Login decomposed into: login-shared, login-flow
- Build decomposed into: plan-converter, step-executor
- UI extracted: tool-status, SyntaxHighlighter
