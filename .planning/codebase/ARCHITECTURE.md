# Architecture

## Pattern

Layered, dependency-inverted architecture. The CLI is the outermost layer; everything else is composed behind narrow interfaces.

```
                     ┌──────────────────────────────┐
                     │  index.ts  (entry / args)    │
                     └──────────────┬───────────────┘
                                    │
                     ┌──────────────▼───────────────┐
                     │  src/cli/ (dispatcher)       │
                     │  handlers/* command shims    │
                     │  shared.ts (createAgent)     │
                     └──────────────┬───────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
┌───────▼────────┐         ┌────────▼────────┐         ┌────────▼─────────┐
│  src/core/     │         │  src/agents/    │         │  src/skills/     │
│  agent loop,   │         │  plan/build/    │         │  loader, parser, │
│  memory,       │         │  explore agents │         │  registry        │
│  tokens,       │         │  + PlanGrammar  │         └──────────────────┘
│  TurnExecutor  │         │  + StepExecutor │
└───────┬────────┘         └────────┬────────┘
        │                           │
        │                  ┌────────▼─────────────────────────┐
        │                  │  src/tools/ (ToolRegistry,       │
        │                  │  bash, file, search, web, skill) │
        │                  └────────┬─────────────────────────┘
        │                           │
        │                  ┌────────▼────────┐
        │                  │  src/providers/ │
        │                  │  OpenAI,        │
        │                  │  Anthropic,     │
        │                  │  Ollama, ...    │
        │                  └────────┬────────┘
        │                           │
        │                  ┌────────▼────────┐
        │                  │  src/mcp/       │
        │                  │  client/manager │
        │                  └─────────────────┘
        │
┌───────▼────────────────────────────────────────────────────────────┐
│  Cross-cutting: src/observability/  src/config/  src/utils/        │
│  src/config/config-io.ts  src/cli/prompt.ts  src/hooks/          │
└───────────────────────────────────────────────────────────────────┘
```

## Key Layers

### 1. Entry (`index.ts`)
- Imports and executes `main()` from `src/cli/index.js`.
- Global error handler catches and reports fatal errors.

### 2. CLI Dispatcher (`src/cli/`, `src/cli/handlers/`)
- `src/cli/main.tsx` mounts the Ink UI, parses CLI args, dispatches to handlers.
- `src/cli/shared.ts` houses `createLLMClient`, `setupTools`, and `createAgent()` — the agent factory that consolidates the full construction sequence (createLLMClient → setupTools → new Agent → createSkillTool → register → waitForSkills). Returns `{ agent, mcpManager, toolRegistry, agentsMdPath }`.
- `src/cli/prompt.ts` — the single source of truth for readline-based user input: `prompt()`, `promptHidden()` (raw-mode `*` masking), `promptChoice()`. Extracted from login.ts, build-agent.ts, and plan-agent.ts.
- `src/cli/chat-commands.ts` — `/-slash` command parser.
- Per-feature handlers: `agent.ts`, `plan.ts`, `state.ts`, `memory.ts`, `config.ts`, `mcp.ts`, `skill.ts`, `trace.ts`, `status.ts`, `upgrade.ts`, `login.ts`.
- Handlers return structured results; the CLI layer never throws to the user.
- **Login/logout** (`src/cli/handlers/login.ts`): dispatched before `loadConfig()` so onboarding works with no config file (ADR-014).

### 3. Agent Loop (`src/core/agent.ts`)
- Drives the conversation: user message → provider call → tool dispatch → response → repeat.
- **TurnExecutor** (`src/core/turn-executor.ts`) — owns the per-turn tool execution + error recovery. Extracted from `runStream()` (~400 lines → testable unit). Handles tool batch execution, not-found/declined/loop-break detection, and returns a structured `TurnResult`.
- **agent-utils.ts** (`src/core/agent-utils.ts`) — `isLooping()`, `truncateOutput()`, `LOOP_DETECTION`, `MAX_OUTPUT_LENGTH`. Extracted to break the circular dependency between `agent.ts` and `turn-executor.ts`.
- Token-bounded via `src/core/tokens.ts`.
- Memory persistence via `src/core/memory.ts`.

### 4. Agents (`src/agents/`)
Three specialized agents share an atomic state file (`.tiny-state.json`) and a canonical plan format defined by `src/agents/plan-grammar.ts`:

| Agent | File | Role |
|---|---|---|
| plan-agent | `plan-agent.ts` | LLM generates an implementation plan in PlanGrammar format |
| build-agent | `build-agent.ts` | Parses a plan and executes its steps (file ops, bash) |
| explore-agent | `explore-agent.ts` | Read-only codebase reconnaissance |

- **StepExecutor** (`src/agents/step-executor.ts`) — owns the per-step action execution + error recovery (retry/skip/abort). Extracted from `buildAgent()`. Uses dependency-injected `promptFn` for testability. `mapBuildAction()` lives here to break the runtime circular dependency with `build-agent.ts` (type-only imports back).
- Shared state types in `src/agents/types.ts`; reader/writer with atomic writes in `src/agents/state.ts`.

### 5. Tool Registry (`src/tools/registry.ts`)
Single `ToolRegistry` instance is constructed per session and accumulates:
- Built-in tools (`file-tools.ts`, `bash-tool.ts`, `search-tools.ts`, `web-search-tool.ts`, `skill-tool.ts`)
- Skills exposed as tools (`skill-tool.ts` wraps the skills loader)
- MCP server tools (registered dynamically as MCP servers connect)
- Plugin tools (`plugin-loader.ts`)

Tools conform to `Tool` interface (`src/tools/types.ts`) with a `name`, `description`, `parameters` JSON Schema, optional `dangerous` callback (for confirmation routing), and an async `execute(args) → ToolResult`.

### 6. Provider Abstraction (`src/providers/`)
Each provider exposes:
- `chat({ model, messages, ... }) → response`
- `chatStream(...)` for streaming responses
- Optional capability flags surfaced via `src/providers/capabilities.ts`

Selection is driven by `model-string` parsing in `src/providers/factory.ts`.

### 7. UI (`src/ui/`)
Ink/React components for the chat layout, message list, streaming text, tool call rendering, status line, toast list, command menu, etc. State surfaces via React contexts (`src/ui/contexts/`).

### 8. Skills (`src/skills/`)
SKILL.md discovery + frontmatter parsing. Built-in skills live in `src/skills/builtin/` and are embedded into the binary at build time via `scripts/generate-embedded-skills.ts`.

### 9. Observability (`src/observability/`)
- Trace every provider call and tool invocation.
- Token usage + cost estimation.
- Opt-in Langfuse export.
- Redacted structured logger.

### 10. Config I/O (`src/config/config-io.ts`)
- Single source of truth for config file reading/writing.
- `readConfigFile()` — YAML/JSON dispatch, returns `{}` on missing/parse error.
- `writeConfigFile()` — creates `CONFIG_DIR`, writes with `0o600` permissions when a literal API key is present (via `chmod` after write for existing files).
- `containsLiteralApiKey()` — detects non-env-var-reference API keys.

## Data Flow: A Single Turn

```
User input
   │
   ▼
src/core/agent.ts                 (main loop)
   │
   ▼ build provider call
src/providers/<x>.ts              (chat / chatStream)
   │
   ▼ tool calls returned by model
src/core/turn-executor.ts         (executeTurn: batch execution + error recovery)
   │  confirmation via src/tools/confirmation.ts
   ▼
src/tools/registry.ts.execute     (single) / .executeBatch (multi)
   │
   ▼
src/tools/<tool>.ts               (file / bash / search / web / skill / mcp-*)
   │
   ▼ tool result back to model
src/core/agent.ts                 (compose next message, loop or finalize)
```

## Shared Abstractions

- **`PlanGrammar`** (`src/agents/plan-grammar.ts`) — single source of truth for the canonical plan markdown format. Consumed by plan-agent (emit), build-agent (parse for execution), and `handlePlan` (parse for display).
- **`ToolRegistry`** — single source of truth for available tools. Re-used by the agent loop, the CLI tool inspector, and any embedded plugin.
- **`StateFile`** (`src/agents/state.ts`) — atomic JSON state shared across plan/build/explore agents.
- **`provider/model-string`** — single source of truth for "which model runs".
- **`createAgent()`** (`src/cli/shared.ts`) — single source of truth for "how to build a fully-wired Agent". Used by both `handleRun` and `handleInteractiveChat`.
- **`config-io.ts`** — single source of truth for config file I/O. Used by `login.ts` and `mcp.ts`.
- **`prompt.ts`** — single source of truth for readline prompting. Used by `login.ts`, `plan-agent.ts`, `step-executor.ts`.

## Plugin Surface

- **Tool plugins** via `src/tools/plugin-loader.ts` — drop a `.ts` file exporting `Tool` and it gets registered at startup.
- **Skills** are a softer extension: any `SKILL.md` under a configured directory is loaded automatically.

## Embedded Mode

For the compiled binary (`bun build --compile`), the skills and version metadata are embedded as TS modules so the binary has no runtime dependency on the source tree. See `scripts/generate-embedded-skills.ts` and `scripts/generate-version.ts`.

## ADRs

Architecture decisions are documented in `docs/adr/` (ADR-001 through ADR-014). See `docs/README.md` for the full index. Key ADRs:

- ADR-005: Tool system design (Tool interface, registry, dangerous-routing)
- ADR-010: Ink CLI integration (React/Ink UI architecture)
- ADR-011: Multi-agent system (plan/build/explore sharing state file + PlanGrammar)
- ADR-012: GatewayOpenAIProvider base class (held back by 30% duplication threshold)
- ADR-013: ClinePass live model lookup (replace baked capability table with live fetch)
- ADR-014: Login command onboarding design (top-level dispatch, status-only chat, literal key storage)
- ADR-015: Lifecycle hooks system (external command spawning, sequential pipeline, plannotator preset)
- ADR-016: Agent decomposition (deletion test, type-only imports, 10 extracted modules)
