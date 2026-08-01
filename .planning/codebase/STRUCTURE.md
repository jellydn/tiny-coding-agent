# STRUCTURE.md — Directory Layout

## Root

```
tiny-agent/
├── src/                    # Source code (21,322 lines TS/TSX)
├── test/                   # Test files (84 test files, ~17,000 lines)
├── docs/                   # ADRs and documentation
│   └── adr/                # Architecture Decision Records (13 ADRs)
├── scripts/                # Build scripts (version gen, embedded skills)
├── .planning/              # Planning docs and codebase map
├── tasks/                  # PRD documents
├── .github/workflows/      # CI/CD (ci.yml, release.yml)
├── homebrew-tiny-agent/    # Homebrew formula
└── .agents/                # Agent configuration
```

## Source (`src/`)

### Core (`src/core/`) — Agent Loop & Memory

| File | Lines | Purpose |
|------|-------|---------|
| `agent.ts` | 417 | Agent class — orchestrator, context setup, delegation to StreamProcessor |
| `stream-processor.ts` | 394 | StreamProcessor — main iteration loop (LLM streaming + tool execution) |
| `memory.ts` | 347 | MemoryStore — persistent memory with LRU eviction |
| `memory-eviction.ts` | ~100 | Eviction strategy (category-weighted, token-budgeted) |
| `agent-observability.ts` | 326 | Observability wrapper (OpenTelemetry spans, cost tracking) |
| `turn-executor.ts` | 236 | TurnExecutor — per-iteration tool dispatch + error recovery |
| `tool-executor.ts` | ~60 | executeToolCalls() — wraps turn execution with observability |
| `agent-utils.ts` | 243 | Pure helpers: isLooping, truncateOutput, streamLlmResponse, streamFinalAnswer |
| `runner-observability.ts` | ~120 | Per-run metrics aggregation |
| `context-budget.ts` | ~100 | Context budgeting (memory + conversation token limits) |
| `context-budget-calc.ts` | ~150 | Calculation functions for context budget |
| `conversation.ts` | ~80 | ConversationManager — chat history persistence |
| `provider-cache.ts` | ~80 | LLM client caching per model |
| `skill-manager.ts` | ~150 | Skill loading, filtering, system prompt construction |
| `tokens.ts` | ~130 | Token counting (tiktoken wrapper) |
| `signal-handler-manager.ts` | ~80 | Graceful shutdown signal handling |
| `debug-logger.ts` | ~120 | Verbose debug logging |

### Providers (`src/providers/`) — LLM Client Abstraction

| File | Lines | Purpose |
|------|-------|---------|
| `openai.ts` | ~200 | OpenAIProvider — base for OpenAI-compatible APIs |
| `anthropic.ts` | 229 | AnthropicProvider — Claude models |
| `anthropic-converters.ts` | ~180 | Anthropic message/tool conversion utilities |
| `ollama.ts` | 316 | OllamaProvider — local model inference |
| `ollama-cloud.ts` | ~50 | OllamaCloudProvider — remote Ollama |
| `openai-protocol.ts` | ~120 | OpenAI message/tool conversion utilities |
| `factory.ts` | ~100 | Provider factory (config → provider class) |
| `model-registry.ts` | ~200 | Model detection, capabilities, provider patterns |
| `provider-utils.ts` | ~80 | Shared provider helpers (token building, catalog fallback) |
| `capabilities.ts` | ~30 | ModelCapabilities interface |
| `types.ts` | ~80 | LLMClient, Message, ToolCall, StreamChunk interfaces |
| `clinepass.ts` | ~80 | ClinePassProvider — pass-through for Cline |
| `qwencloud.ts` | ~80 | QwenCloudProvider — Qwen/DeepSeek models |
| `zai.ts` | ~60 | ZaiProvider — Z.ai GLM models |
| `opencode.ts` | ~40 | OpenCodeProvider — OpenCode adapter |
| `openrouter.ts` | ~60 | OpenRouterProvider — OpenRouter adapter |
| `models-dev.ts` | ~40 | Model catalog from @tokenlens/models |

### Tools (`src/tools/`) — Built-in Tool System

| File | Lines | Purpose |
|------|-------|---------|
| `file-tools.ts` | 326 | File operations (read, write, edit, delete, list) |
| `bash-tool.ts` | 281 | Shell command execution with safety checks |
| `search-tools.ts` | 329 | grep + glob search tools |
| `skill-tool.ts` | ~80 | Skill loading tool |
| `web-search-tool.ts` | ~60 | Web search via DuckDuckGo |
| `registry.ts` | ~100 | ToolRegistry — tool registration + batch execution |
| `confirmation.ts` | ~80 | Dangerous tool confirmation system |
| `gitignore.ts` | ~140 | .gitignore parsing + pattern matching |
| `file-utils.ts` | ~130 | Path validation, error handling helpers |
| `search-utils.ts` | ~70 | Shared search formatting utilities |
| `plugin-loader.ts` | ~60 | External tool plugin loading |
| `types.ts` | ~40 | Tool, ToolResult, ToolParameters interfaces |
| `search-providers/` | | Search provider abstraction (DuckDuckGo) |

### Agents (`src/agents/`) — Specialized Agent Types

| File | Lines | Purpose |
|------|-------|---------|
| `build-agent.ts` | 295 | Build agent — executes step-by-step plans |
| `plan-agent.ts` | ~150 | Plan agent — generates implementation plans |
| `explore-agent.ts` | ~100 | Explore agent — codebase exploration |
| `codebase-explorer.ts` | 286 | CodebaseExplorer — file analysis, metrics |
| `file-analyzer.ts` | ~180 | File analysis (LOC, dependencies, file counts) |
| `step-executor.ts` | 217 | Step-by-step plan execution |
| `plan-converter.ts` | ~130 | Plan → BuildStep conversion |
| `plan-parser.ts` | 277 | Plan grammar parser |
| `plan-grammar.ts` | ~200 | Plan grammar definition |
| `plan-types.ts` | ~40 | Plan, Step, Phase types |
| `plan-validator.ts` | ~60 | Plan validation |
| `state-manager.ts` | ~100 | State persistence (JSON file) |
| `state.ts` | ~80 | State file read/write |
| `agent-client.ts` | ~80 | Agent client creation |
| `types.ts` | ~40 | Agent phase, status types |

### CLI (`src/cli/`) — Command-Line Interface

| File | Lines | Purpose |
|------|-------|---------|
| `main.tsx` | 288 | Entry point — CLI argument parsing, Ink app |
| `command-dispatch.ts` | 265 | Command routing (login, plan, agent, etc.) |
| `shared.ts` | 251 | Agent setup, tool registry, LLM client creation |
| `chat-commands.ts` | ~100 | Chat command parsing (/help, /clear, etc.) |
| `status-line.ts` | ~150 | Status line display |
| `mcp-setup.ts` | ~60 | MCP server initialization |
| `prompt.ts` | ~50 | Prompt injection for DI |
| `help-text.ts` | ~140 | Help text generation |
| `handlers/` | | Command-specific handlers |
| `handlers/login.ts` | | Provider authentication |
| `handlers/login-flow.ts` | 346 | Interactive login flow |
| `handlers/login-shared.ts` | 252 | Shared login utilities |
| `handlers/plan.ts` | | Plan command handler |
| `handlers/agent.ts` | 218 | Agent command handler |
| `handlers/trace.ts` | | Trace command handler |
| `handlers/config.ts` | | Config command handler |
| `handlers/state.ts` | | State command handler |
| `handlers/skill.ts` | | Skill command handler |
| `handlers/mcp.ts` | | MCP command handler |
| `handlers/memory.ts` | | Memory command handler |
| `handlers/hooks.ts` | 254 | Hooks management |
| `handlers/review.ts` | | Review command handler |
| `handlers/upgrade.ts` | | Self-upgrade handler |
| `handlers/status.ts` | | Status command handler |

### UI (`src/ui/`) — Ink React Components

| File | Lines | Purpose |
|------|-------|---------|
| `App.tsx` | 239 | Root component — chat session management |
| `contexts/ChatContext.tsx` | 303 | Chat state management (messages, streaming) |
| `contexts/StatusLineContext.tsx` | | Status line state |
| `contexts/ToastContext.tsx` | | Toast notifications |
| `components/ChatLayout.tsx` | 249 | Main chat layout |
| `components/MessageList.tsx` | | Message rendering |
| `components/Message.tsx` | | Individual message display |
| `components/ToolCall.tsx` | | Tool call display |
| `components/ToolOutput.tsx` | | Tool output rendering |
| `components/ModelPicker.tsx` | | Model selection UI |
| `components/SkillPicker.tsx` | | Skill selection UI |
| `components/AgentSwitcher.tsx` | | Agent type switching |
| `components/CommandMenu.tsx` | | Command menu |
| `components/Header.tsx` | | App header |
| `components/TextInput.tsx` | | User input |
| `components/StreamingText.tsx` | | Streaming response display |
| `components/ThinkingIndicator.tsx` | | Thinking animation |
| `components/ToolsPanel.tsx` | | Tools panel display |
| `components/ContextStatus.tsx` | | Context window status |
| `components/StatusLine.tsx` | | Status line component |
| `components/Spinner.tsx` | | Loading spinner |
| `hooks/useCommandHandler.ts` | 229 | Command handling hook |
| `model-data.ts` | ~200 | Model data for provider picker |
| `chat-command-registry.ts` | ~80 | Chat command registry |
| `status-line-manager.ts` | ~100 | Status line state management |
| `utils.ts` | ~40 | UI utilities (TTY, timestamps) |
| `errors/chat-errors.ts` | ~50 | Typed error classes |
| `types/enums.ts` | | Shared enums (MessageRole, ToolStatus) |

### Config (`src/config/`) — Configuration Management

| File | Lines | Purpose |
|------|-------|---------|
| `schema.ts` | 247 | Zod schema (Config, ProviderConfig, etc.) |
| `loader.ts` | ~200 | Config loading (YAML/JSON, env interpolation) |
| `config-env.ts` | ~200 | Environment variable interpolation + overrides |
| `config-template.ts` | ~60 | Default YAML template generation |
| `config-io.ts` | ~50 | Config file I/O helpers |

### Skills (`src/skills/`) — Skill System

| File | Lines | Purpose |
|------|-------|---------|
| `loader.ts` | ~100 | Skill discovery + loading |
| `parser.ts` | ~50 | YAML frontmatter parsing |
| `signature.ts` | 320 | Plugin signature verification |
| `prompt.ts` | ~40 | Skills prompt generation |
| `builtin-registry.ts` | ~40 | Embedded skill registry |
| `types.ts` | ~30 | Skill, SkillMetadata interfaces |

### MCP (`src/mcp/`) — Model Context Protocol

| File | Lines | Purpose |
|------|-------|---------|
| `client.ts` | ~80 | MCP client (stdio transport) |
| `manager.ts` | ~120 | MCP server lifecycle management |
| `types.ts` | ~40 | MCP types |

### Observability (`src/observability/`) — Telemetry & Logging

| File | Lines | Purpose |
|------|-------|---------|
| `telemetry.ts` | 232 | OpenTelemetry setup + span management |
| `trace-context.ts` | ~110 | AsyncLocalStorage trace context |
| `langfuse.ts` | ~170 | Langfuse integration (optional) |
| `logger.ts` | ~200 | Structured logging |
| `redact.ts` | ~120 | Secret redaction |
| `pricing.ts` | ~70 | Model pricing (embedded JSON) |
| `cost.ts` | ~40 | Cost estimation |
| `token-usage.ts` | ~130 | Token usage normalization |
| `timer.ts` | ~20 | Simple timer utility |

### Utils (`src/utils/`) — Shared Utilities

| File | Lines | Purpose |
|------|-------|---------|
| `command.ts` | ~20 | Command availability check |
| `xml.ts` | ~20 | XML escaping |
| `version.ts` | ~10 | Version constant |
| `retry.ts` | ~140 | Retry with backoff |
