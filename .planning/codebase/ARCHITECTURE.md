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
                     └──────────────┬───────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
┌───────▼────────┐         ┌────────▼────────┐         ┌────────▼─────────┐
│  src/core/     │         │  src/agents/    │         │  src/skills/     │
│  agent loop,   │         │  plan/build/    │         │  loader, parser, │
│  memory,       │         │  explore agents │         │  registry        │
│  tokens        │         │  + PlanGrammar  │         └──────────────────┘
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
└───────────────────────────────────────────────────────────────────┘
```

## Key Layers

### 1. Entry (`index.ts`)
- Parses CLI args with `src/utils/command.ts`.
- Loads config (`src/config/loader.ts`).
- Boots the agent loop (`src/core/agent.ts`) with the resolved provider and tool registry.
- Handles `--upgrade` (delegates to `src/cli/handlers/upgrade.ts`) and `--help`.

### 2. CLI Dispatcher (`src/cli/`, `src/cli/handlers/`)
- `src/cli/main.tsx` mounts the Ink UI.
- `src/cli/chat-commands.ts` and the per-feature handlers (`plan.ts`, `agent.ts`, `state.ts`, `memory.ts`, `config.ts`, `mcp.ts`, `skill.ts`, `trace.ts`, `status.ts`, `upgrade.ts`, `login.ts`) implement each subcommand.
- Handlers return structured results; the CLI layer never throws to the user.

### 3. Agent Loop (`src/core/agent.ts`)
- Drives the conversation: user message → provider call → tool dispatch → response → repeat.
- Token-bounded via `src/core/tokens.ts`.
- Memory persistence via `src/core/memory.ts`.

### 4. Agents (`src/agents/`)
Three specialized agents share an atomic state file (`.tiny-state.json`) and a canonical plan format defined by `src/agents/plan-grammar.ts`:

| Agent | File | Role |
|---|---|---|
| plan-agent | `plan-agent.ts` | LLM generates an implementation plan in PlanGrammar format |
| build-agent | `build-agent.ts` | Parses a plan and executes its steps (file ops, bash) |
| explore-agent | `explore-agent.ts` | Read-only codebase reconnaissance |

Shared state types in `src/agents/types.ts`; reader/writer with atomic writes in `src/agents/state.ts`.

### 5. Tool Registry (`src/tools/registry.ts`)
Single `ToolRegistry` instance is constructed per session and accumulates:
- Built-in tools (`file-tools.ts`, `bash-tool.ts`, `search-tools.ts`, `web-search-tool.ts`, `skill-tool.ts`)
- Skills exposed as tools (`skill-tool.ts` wraps the skills loader)
- MCP server tools (registered dynamically as MCP servers connect)

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
src/tools/registry.ts.execute     (single) / .executeBatch (multi)
   │  confirmation via src/tools/confirmation.ts
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

## Plugin Surface

- **Tool plugins** via `src/tools/plugin-loader.ts` — drop a `.ts` file exporting `Tool` and it gets registered at startup.
- **Skills** are a softer extension: any `SKILL.md` under a configured directory is loaded automatically.

## Embedded Mode

For the compiled binary (`bun build --compile`), the skills and version metadata are embedded as TS modules so the binary has no runtime dependency on the source tree. See `scripts/generate-embedded-skills.ts` and `scripts/generate-version.ts`.
