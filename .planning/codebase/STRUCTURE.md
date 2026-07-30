# Directory Structure

```
src/
├── agents/           # Agent types — plan, build, explore, state management
│   ├── agent-client.ts       # LLM client creation for agent use
│   ├── build-agent.ts        # Build execution agent
│   ├── codebase-explorer.ts  # Codebase exploration logic
│   ├── explore-agent.ts      # Exploration orchestrator
│   ├── plan-agent.ts         # Plan generation agent
│   ├── plan-converter.ts     # Plan → BuildStep conversion
│   ├── plan-grammar.ts       # Plan markdown parser/serializer/validator
│   ├── state-manager.ts      # State file management
│   ├── state.ts              # State types and file I/O
│   └── step-executor.ts      # Per-step action execution
│
├── cli/              # CLI interface and command handlers
│   ├── main.tsx               # Entry point, run/chat modes
│   ├── chat-command-registry.ts # /help, /clear, /model etc.
│   ├── command-dispatch.ts    # Central command routing
│   ├── help-text.ts           # Help text content
│   ├── prompt.ts              # User prompt DI singleton
│   ├── shared.ts              # Shared CLI utilities
│   ├── status-line.ts         # Status line display
│   ├── tool-display.tsx       # Tool execution display
│   └── handlers/              # Per-command handlers
│       ├── agent.ts, config.ts, hooks.ts, login*.ts
│       ├── mcp.ts, memory.ts, plan.ts, review.ts
│       ├── skill.ts, state.ts, status.ts, trace.ts
│       └── upgrade.ts
│
├── config/           # Configuration loading
│   ├── loader.ts             # YAML config loader
│   └── schema.ts             # Zod schema
│
├── core/              # Agent loop, memory, tools, providers
│   ├── agent.ts               # Agent class — runStream, run, health
│   ├── agent-observability.ts # Telemetry wrapper
│   ├── agent-utils.ts         # Loop detection, stream helpers
│   ├── context-budget.ts      # Context window management
│   ├── conversation.ts        # Conversation persistence
│   ├── debug-logger.ts        # Verbose logging
│   ├── memory.ts              # MemoryStore class
│   ├── provider-cache.ts      # LLM client cache
│   ├── signal-handler-manager.ts # Process signal handlers
│   ├── skill-manager.ts       # Skill discovery/loading
│   ├── tokens.ts              # Token counting
│   └── turn-executor.ts       # Per-iteration tool execution
│
├── hooks/            # Lifecycle hook system
│   ├── index.ts, manager.ts, types.ts
│
├── mcp/              # Model Context Protocol
│   ├── client.ts, manager.ts, types.ts
│
├── observability/    # Telemetry and logging
│   ├── logger.ts, langfuse.ts, telemetry.ts
│   ├── redact.ts, trace-context.ts, cost.ts
│   └── token-usage.ts, pricing.ts
│
├── providers/        # LLM provider implementations
│   ├── types.ts, factory.ts, index.ts
│   ├── anthropic.ts, openai.ts, ollama.ts
│   ├── clinepass.ts, zai.ts, openrouter.ts
│   └── model-registry.ts, capabilities.ts
│
├── skills/           # Skill system
│   ├── loader.ts, parser.ts, prompt.ts
│   ├── signature.ts, types.ts, builtin-registry.ts
│   └── builtin/  # Embedded skill files
│
├── tools/            # Tool system
│   ├── registry.ts, types.ts, bash-tool.ts
│   ├── file-tools.ts, search-tools.ts
│   ├── web-search-tool.ts, confirmation.ts
│   └── plugin-loader.ts
│
├── ui/               # Ink React components
│   ├── App.tsx, utils.ts
│   ├── components/   # UI components
│   │   ├── AgentSwitcher, ChatLayout, CommandMenu
│   │   ├── Header, HeaderBox, Message, MessageList
│   │   ├── ModelPicker, SkillPicker, Spinner
│   │   ├── StatusLine, StreamingText, ThinkingIndicator
│   │   ├── ToastList, TextInput, ToolCall, ToolOutput
│   │   ├── ToolsPanel, ContextStatus
│   │   ├── tool-status.ts     # Unified tool display helpers
│   │   └── SyntaxHighlighter.tsx # Diff/git syntax renderer
│   ├── contexts/     # React contexts
│   │   ├── ChatContext.tsx, StatusLineContext.tsx
│   │   └── ToastContext.tsx
│   └── hooks/        # Custom hooks
│       └── useCommandHandler.ts
│
└── utils/            # Shared utilities
    ├── xml.ts, command.ts, retry.ts, version.ts
```
