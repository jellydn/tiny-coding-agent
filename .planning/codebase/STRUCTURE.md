# Directory Structure

## Overview

```
tiny-coding-agent/
├── index.ts                 # Entry point → main()
├── package.json             # Dependencies + scripts
├── tsconfig.json            # TypeScript config (strict, NodeNext)
├── biome.json               # Linter + formatter
├── bun.lock                 # Bun lockfile
├── src/                     # Source code (139 files, ~20k lines)
│   ├── agents/              # Multi-agent system (plan, build, explore)
│   ├── cli/                 # CLI interface + command handlers
│   ├── config/              # Configuration schema + loading
│   ├── core/                # Agent loop + extracted modules
│   ├── hooks/               # Lifecycle hooks system
│   ├── mcp/                 # MCP client integration
│   ├── observability/       # Telemetry, logging, cost tracking
│   ├── providers/           # LLM provider implementations
│   ├── skills/              # Skill discovery + loading
│   ├── tools/               # Built-in tools + registry
│   ├── ui/                  # Ink React CLI components
│   └── utils/               # Shared utilities
├── test/                    # Test files (80 files, ~17k lines)
├── docs/                    # Documentation + ADRs
├── scripts/                 # Build scripts + ralph automation
├── .github/                 # CI workflows + Homebrew formula
└── .planning/codebase/      # This codebase map
```

## Source Layout (`src/`)

### `src/core/` — Agent Loop & Extracted Modules

| File | Lines | Purpose |
|------|-------|---------|
| `agent.ts` | 738 | Agent class — orchestrates the LLM conversation loop |
| `memory.ts` | 422 | MemoryStore — user-initiated memory storage + retrieval |
| `agent-observability.ts` | 326 | AgentObservability — span/timer management wrapper |
| `context-budget.ts` | 276 | prepareContext() — context window budgeting + memory merge |
| `turn-executor.ts` | 236 | TurnExecutor — one LLM call + tool batch execution |
| `agent-utils.ts` | 228 | streamLlmResponse(), streamFinalAnswer(), isLooping() |
| `provider-cache.ts` | 134 | ProviderCache — LLM client cache with eviction |
| `debug-logger.ts` | 132 | DebugLogger — verbose logging (no-op when disabled) |
| `conversation.ts` | — | ConversationManager — history persistence |
| `tokens.ts` | — | Token counting utilities (tiktoken) |
| `index.ts` | — | Re-exports |

### `src/agents/` — Multi-Agent System

| File | Lines | Purpose |
|------|-------|---------|
| `build-agent.ts` | 461 | Build executor — parses plan, executes steps |
| `codebase-explorer.ts` | 381 | Filesystem exploration (shallow + deep modes) |
| `plan-grammar.ts` | 437 | Plan markdown parser → phases/steps AST |
| `explore-agent.ts` | 234 | Codebase analysis agent |
| `plan-agent.ts` | 231 | Plan generation agent |
| `step-executor.ts` | 217 | StepExecutor — retry/skip/abort flow |
| `state.ts` | — | State file I/O with file locking + rotation |
| `types.ts` | — | StateFile, AgentPhase, AgentStatus types |

### `src/cli/` — CLI Interface

| File | Lines | Purpose |
|------|-------|---------|
| `main.tsx` | 541 | Entry point — main(), handleRun(), handleInteractiveChat() |
| `command-dispatch.ts` | 265 | Command dispatch table (pre/post config) |
| `shared.ts` | 280 | parseArgs(), createLLMClient(), setupTools(), createAgent() |
| `prompt.ts` | — | readline prompt helpers (prompt, promptHidden) |
| `handlers/` | — | One file per CLI command (login, logout, plan, hooks, etc.) |

### `src/providers/` — LLM Provider Implementations

| File | Lines | Purpose |
|------|-------|---------|
| `anthropic.ts` | 370 | Anthropic Claude provider |
| `ollama.ts` | 324 | Ollama local provider |
| `factory.ts` | — | createProvider() factory + parseModelString() |
| `model-registry.ts` | — | detectProvider() + model capability lookup |
| `openai.ts` | — | OpenAI provider |
| `openrouter.ts` | — | OpenRouter provider |
| `opencode.ts` | — | OpenCode provider |
| `zai.ts` | — | Z.AI (Zhipu) provider |
| `clinepass.ts` | — | ClinePass provider (live model lookup, ADR-013) |
| `qwencloud.ts` | — | QwenCloud provider |
| `capabilities.ts` | — | Model capability checks |
| `openai-protocol.ts` | — | Shared OpenAI-compatible protocol |
| `types.ts` | — | LLMClient, Message, TokenUsage interfaces |

### `src/tools/` — Built-in Tools

| File | Lines | Purpose |
|------|-------|---------|
| `file-tools.ts` | 449 | read_file, write_file, edit_file, delete_file |
| `search-tools.ts` | 354 | grep, glob tools |
| `bash-tool.ts` | 281 | Bash command execution |
| `registry.ts` | 204 | ToolRegistry class |
| `confirmation.ts` | — | User confirmation system (ADR-009) |
| `skill-tool.ts` | — | Skill loading tool |
| `plugin-loader.ts` | — | Dynamic plugin loading |
| `web-search-tool.ts` | — | Web search tool |
| `gitignore.ts` | — | .gitignore-aware file filtering |
| `types.ts` | — | Tool, ToolResult, ToolParameters interfaces |

### `src/ui/` — Ink React Components

| File | Lines | Purpose |
|------|-------|---------|
| `hooks/useCommandHandler.ts` | 458 | Slash command dispatcher (/help, /model, /plan, etc.) |
| `components/Message.tsx` | 382 | Message rendering (markdown, code blocks) |
| `components/ModelPicker.tsx` | 380 | Model selection UI |
| `contexts/ChatContext.tsx` | 303 | Chat state management |
| `components/ChatLayout.tsx` | 249 | Main chat layout |
| `App.tsx` | 239 | Root app component |
| `chat-command-registry.ts` | 77 | Command registry + help text generation |

### `src/config/` — Configuration

| File | Lines | Purpose |
|------|-------|---------|
| `loader.ts` | 324 | loadConfig(), getConfigPath(), createDefaultConfig() |
| `schema.ts` | 247 | Zod-validated Config interface + schemas |
| `config-io.ts` | — | readConfigFile(), writeConfigFile() (YAML/JSON) |

### `src/hooks/` — Lifecycle Hooks (ADR-015)

| File | Purpose |
|------|---------|
| `types.ts` | HookConfig, HookEvent, HookRegistry types |
| `manager.ts` | buildRegistry(), runHooks(), hasHooks() |
| `presets.ts` | PLANNOTATOR_PRESET, findPreset() |
| `index.ts` | Re-exports |

### `src/observability/` — Telemetry & Logging

| File | Purpose |
|------|---------|
| `telemetry.ts` | OpenTelemetry span management |
| `logger.ts` | Structured JSON logging |
| `cost.ts` | Token cost estimation |
| `pricing.ts` | Model pricing data |
| `redact.ts` | API key masking |
| `langfuse.ts` | Optional Langfuse integration |
| `token-usage.ts` | Token usage tracking |
| `trace-context.ts` | Trace context propagation |

## Test Layout (`test/`)

Tests mirror the `src/` structure:

```
test/
├── agents/          # Agent tests (build, explore, plan, state, step-executor)
├── cli/             # CLI tests (handlers, command-dispatch, integration)
├── config/          # Config tests (loader, config-io)
├── core/            # Core tests (agent, memory, turn-executor, observability)
├── e2e/             # End-to-end agent loop test
├── hooks/           # Hooks tests (manager, presets, types)
├── mcp/             # MCP tests (manager, errors)
├── observability/   # Observability tests (telemetry, cost, redact, langfuse)
├── providers/       # Provider tests (anthropic, clinepass, model-registry, ollama)
├── security/        # Security tests (command-injection, bash-env, file-validation)
├── skills/          # Skills tests (loader, parser, prompt, builtin-registry)
├── tools/           # Tool tests (bash, file, search, registry, skill-tool)
├── ui/              # UI tests (chat-command-registry, model-picker, utils)
└── utils/           # Utility tests (command, xml)
```

## Documentation

```
docs/
├── README.md        # Documentation index
├── adr/             # 16 Architecture Decision Records (001-016)
└── development-tasks.md
```

## Naming Conventions

- **Files**: kebab-case (`file-tools.ts`, `agent-observability.ts`)
- **Classes/Types**: PascalCase (`ToolRegistry`, `StateManager`, `LLMClient`)
- **Functions/Variables**: camelCase (`loadConfig`, `createProvider`)
- **Constants**: SCREAMING_SNAKE_CASE (`DEFAULT_STATE_FILE`, `MAX_STATE_FILE_SIZE`)
- **Private members**: `_prefix` (`_providerCache`, `_toolRegistry`)
- **Imports**: `.js` extension for internal modules, `node:` prefix for Node builtins
- **Types**: explicit `import type` (enforced by `verbatimModuleSyntax`)
