# Architecture

## System Overview

Tiny Coding Agent is a CLI-based AI coding assistant built with TypeScript, Bun, and Ink (React for terminal). It follows a layered architecture with clear separation between the agent loop, provider abstraction, tool system, and CLI/UI layers.

```
┌─────────────────────────────────────────────────────┐
│                    CLI / UI Layer                     │
│  src/cli/ (main.tsx, command-dispatch, handlers)     │
│  src/ui/  (Ink React components, hooks, contexts)    │
├─────────────────────────────────────────────────────┤
│                   Agent System Layer                   │
│  src/agents/ (plan, build, explore, state, grammar)   │
│  src/core/   (agent loop, memory, context, tokens)    │
├─────────────────────────────────────────────────────┤
│                  Cross-Cutting Layer                   │
│  src/providers/  (LLM clients + factory)              │
│  src/tools/      (tool registry + built-in tools)     │
│  src/skills/     (skill discovery + loading)          │
│  src/mcp/        (MCP client + manager)               │
│  src/hooks/      (lifecycle hooks + presets)          │
│  src/observability/ (telemetry, logging, cost)        │
├─────────────────────────────────────────────────────┤
│                    Config Layer                        │
│  src/config/ (schema, loader, config-io)              │
└─────────────────────────────────────────────────────┘
```

## Entry Point

`index.ts` → `src/cli/index.ts` → `src/cli/main.tsx` → `main()`

The `main()` function:
1. Parses CLI args (`src/cli/shared.ts` → `parseArgs()`)
2. Dispatches pre-config commands (login, logout) before `loadConfig()`
3. Loads config (`src/config/loader.ts` → `loadConfig()`)
4. Dispatches the main command via `src/cli/command-dispatch.ts`

## Agent Loop (ADR-016 Decomposition)

The `Agent` class (`src/core/agent.ts`, 738 lines) orchestrates the LLM conversation loop. After ADR-016, it was decomposed into 10 focused modules:

| Module | File | Lines | Responsibility |
|--------|------|-------|----------------|
| Agent | `src/core/agent.ts` | 738 | Orchestrator — owns conversation, skills, public interface |
| TurnExecutor | `src/core/turn-executor.ts` | 236 | One LLM call + tool batch execution |
| AgentObservability | `src/core/agent-observability.ts` | 326 | Span/timer management, telemetry wrapper |
| agent-utils | `src/core/agent-utils.ts` | 228 | `streamLlmResponse()`, `streamFinalAnswer()`, `isLooping()` |
| context-budget | `src/core/context-budget.ts` | 276 | `prepareContext()`, `buildContextStats()` |
| DebugLogger | `src/core/debug-logger.ts` | 132 | Verbose logging (no-op when disabled) |
| ProviderCache | `src/core/provider-cache.ts` | 134 | LLM client cache with eviction + health tracking |
| ConversationManager | `src/core/conversation.ts` | — | Conversation history persistence |
| MemoryStore | `src/core/memory.ts` | 422 | User-initiated memory storage + retrieval |
| CodebaseExplorer | `src/agents/codebase-explorer.ts` | 381 | Filesystem exploration for plan/explore agents |

### Agent Loop Flow (`Agent.runStream()`)

```
runStream(prompt, model)
  │
  ├── await skills initialization
  ├── observability: beginRequest()
  ├── prepareContext() → context-budget.ts
  │     ├── memory retrieval (if enabled)
  │     └── context window budgeting
  │
  └── for each iteration (max 20):
        ├── streamLlmResponse() → agent-utils.ts
        │     └── yields content chunks + returns tool calls
        ├── if no tool calls → yield final answer, return
        ├── TurnExecutor.executeTurn() → turn-executor.ts
        │     └── runs tools, returns results + error recovery
        ├── if loop detected → streamFinalAnswer() → agent-utils.ts
        └── update context stats
```

## Multi-Agent System (ADR-011)

Three specialized agents coordinate via a shared state file (`.tiny-state.json`):

| Agent | File | Purpose |
|-------|------|---------|
| Plan Agent | `src/agents/plan-agent.ts` | Generates implementation plans from task descriptions |
| Build Agent | `src/agents/build-agent.ts` | Executes plan steps with tool calls |
| Explore Agent | `src/agents/explore-agent.ts` | Read-only codebase analysis |

### State Management

- **State File**: `.tiny-state.json` (JSON with file locking + rotation)
- **Types**: `src/agents/types.ts` — `StateFile`, `AgentPhase`, `AgentStatus`, `AgentResult`
- **I/O**: `src/agents/state.ts` — `readStateFile()`, `writeStateFile()` with lock files
- **Plan Grammar**: `src/agents/plan-grammar.ts` — parses plan markdown into phases/steps
- **Step Execution**: `src/agents/step-executor.ts` — `StepExecutor` class for retry/skip/abort flow

### Agent Communication Flow

```
planAgent(task) → writes plan to state file
buildAgent(plan) → reads plan, executes steps, writes results to state file
exploreAgent(task) → reads codebase, writes findings to state file
```

## Provider Abstraction (ADR-002)

All LLM providers implement the `LLMClient` interface (`src/providers/types.ts`):

```typescript
interface LLMClient {
  chat(params: ChatParams): Promise<ChatResponse>;
  chatStream(params: ChatParams): AsyncGenerator<string>;
}
```

- **Factory**: `createProvider({model, provider, providers})` in `src/providers/factory.ts`
- **Model Registry**: `detectProvider(model)` in `src/providers/model-registry.ts` — auto-detects provider from model string prefix
- **9 providers**: OpenAI, Anthropic, Ollama, Ollama Cloud, OpenRouter, OpenCode, Z.AI, ClinePass, QwenCloud
- **GatewayOpenAIProvider**: Not used (ADR-012 — held back by 30% threshold rule)

## Tool System (ADR-005)

- **Registry**: `ToolRegistry` class in `src/tools/registry.ts` — register, list, execute
- **Interface**: `Tool` interface in `src/tools/types.ts` — name, description, parameters, execute
- **Built-in tools**: file operations, bash, grep, glob, web search, skill loading
- **Plugin loading**: `src/tools/plugin-loader.ts` — dynamically loads tool plugins
- **Confirmation**: `src/tools/confirmation.ts` — user confirmation for dangerous tools (ADR-009)
- **MCP tools**: Auto-registered from MCP servers with `mcp_` prefix

## Skill System

- **Discovery**: `discoverSkills(directories, builtinDir)` in `src/skills/loader.ts`
- **Parsing**: `parseSkillFrontmatter(content)` in `src/skills/parser.ts` — YAML frontmatter
- **Built-in**: `src/skills/builtin-registry.ts` — embedded skills (code-simplifier)
- **Loading**: `Agent.loadSkill(name)` — reads file, wraps in XML, restricts tools
- **Embedded content**: `src/skills/embedded-content.ts` — generated at build time

## Config System

- **Schema**: `src/config/schema.ts` — Zod-validated `Config` interface
- **Loader**: `src/config/loader.ts` — `loadConfig()`, `getConfigPath()`, `createDefaultConfig()`
- **Config I/O**: `src/config/config-io.ts` — `readConfigFile()`, `writeConfigFile()` with YAML/JSON dispatch
- **Location**: `~/.tiny-agent/config.yaml`

## Observability Layer

- **Telemetry**: `src/observability/telemetry.ts` — OpenTelemetry spans + timers
- **Logging**: `src/observability/logger.ts` — structured JSON logging
- **Cost**: `src/observability/cost.ts` — token cost estimation
- **Redaction**: `src/observability/redact.ts` — API key masking
- **Langfuse**: `src/observability/langfuse.ts` — optional LLM observability platform

## Key ADRs

| ADR | Title | Key Decision |
|-----|-------|-------------|
| ADR-001 | Project Architecture | Layered architecture with clear separation |
| ADR-002 | LLM Provider Abstraction | Unified `LLMClient` interface |
| ADR-004 | Context Management | Handoff/pickup pattern for context budget |
| ADR-005 | Tool System Design | Tool interface + registry pattern |
| ADR-010 | Ink CLI Integration | React-based terminal UI |
| ADR-011 | Multi-Agent System | Plan/Build/Explore agents with shared state file |
| ADR-012 | GatewayOpenAIProvider | No shared base class (30% threshold rule) |
| ADR-014 | Login Command | Top-level command, literal key storage |
| ADR-015 | Lifecycle Hooks | External command spawning at lifecycle events |
| ADR-016 | Agent Decomposition | Extract focused modules via deletion test + type-only imports |
