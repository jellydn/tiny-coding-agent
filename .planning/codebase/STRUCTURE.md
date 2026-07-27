# Structure

```
tiny-coding-agent/
├── index.ts                          # CLI entry — calls main() from src/cli/index.js
├── package.json                      # scripts, deps, release metadata
├── tsconfig.json                     # strict TS, ESM, paths (@/* → ./src/*)
├── biome.json                        # lint + format (tabs, double quotes, 120 width)
├── bump.config.ts                    # bumpp version bump configuration
├── Justfile                          # task runner recipes (dev/build/test/lint/release)
├── Makefile                          # legacy wrapper (same recipes)
├── prek.toml                         # pre-commit hooks (biome + tsc)
├── cspell.json                       # spell-check dictionary
├── renovate.json                     # dep update automation
├── bun.lock                          # bun lockfile
├── AGENTS.md                         # contributor conventions (kebab-case, ESM, etc.)
├── CLAUDE.md                         # Claude-specific notes (→ @AGENTS.md)
├── SECURITY.md                       # security policy
├── README.md                         # user-facing guide (install, login, config, CLI commands)
├── RELEASE.md                        # release process docs
│
├── src/
│   ├── cli/                          # CLI dispatch + per-feature handlers
│   │   ├── main.tsx                  # Ink app mount, arg parsing, command dispatch
│   │   ├── chat-commands.ts          # /-slash command parser
│   │   ├── shared.ts                 # createLLMClient, setupTools, createAgent() factory
│   │   ├── prompt.ts                 # prompt(), promptHidden(), promptChoice() — readline helpers
│   │   ├── status-line.ts            # status line rendering
│   │   ├── index.ts                  # barrel
│   │   └── handlers/
│   │       ├── agent.ts, plan.ts, state.ts, memory.ts
│   │       ├── config.ts, mcp.ts, skill.ts, trace.ts
│   │       ├── status.ts, upgrade.ts
│   │       └── login.ts              # handleLogin() + handleLogout() (onboarding, ADR-014)
│   │
│   ├── core/                         # agent loop primitives
│   │   ├── agent.ts                  # main loop (uses TurnExecutor for tool dispatch)
│   │   ├── agent-utils.ts            # isLooping(), truncateOutput(), LOOP_DETECTION
│   │   ├── turn-executor.ts          # TurnExecutor — per-turn tool execution + error recovery
│   │   ├── memory.ts                 # persistent memory store
│   │   ├── tokens.ts                 # token counting / budget
│   │   ├── conversation.ts           # conversation state management
│   │   └── index.ts                  # barrel (exports Agent, AgentOptions, MemoryStore, etc.)
│   │
│   ├── agents/                       # multi-agent system
│   │   ├── plan-agent.ts             # LLM-driven plan generation
│   │   ├── build-agent.ts            # plan execution via ToolRegistry + StepExecutor
│   │   ├── explore-agent.ts          # read-only recon
│   │   ├── step-executor.ts          # StepExecutor — per-step execution + retry/skip/abort
│   │   ├── plan-grammar.ts           # canonical plan format (deep module)
│   │   ├── state.ts                  # atomic .tiny-state.json reader/writer
│   │   ├── types.ts                  # StateFile, StateError, BuildStep, BuildAction, etc.
│   │   └── index.ts
│   │
│   ├── tools/                        # Tool implementations + registry
│   │   ├── registry.ts               # ToolRegistry class (the spine)
│   │   ├── types.ts                  # Tool, ToolResult, OpenAI/Anthropic defs
│   │   ├── confirmation.ts           # dangerous-op confirmation routing
│   │   ├── file-tools.ts             # read_file / write_file / edit_file / list_directory / delete_file
│   │   ├── bash-tool.ts              # bash with safety classifier
│   │   ├── search-tools.ts           # glob / grep
│   │   ├── web-search-tool.ts        # web search dispatcher
│   │   ├── search-providers/         # DuckDuckGo + provider abstraction
│   │   ├── skill-tool.ts             # skills-as-tools bridge
│   │   ├── plugin-loader.ts          # drop-in .ts plugins
│   │   ├── gitignore.ts              # .gitignore-aware file ops
│   │   └── index.ts                  # barrel
│   │
│   ├── providers/                    # LLM providers
│   │   ├── types.ts                  # Provider interface, Message, ChatOptions
│   │   ├── factory.ts                # model-string → provider instance
│   │   ├── capabilities.ts           # per-model capability matrix
│   │   ├── model-registry.ts         # in-memory model catalog + detectProvider()
│   │   ├── models-dev.ts             # fetch from models.dev JSON
│   │   ├── model-pricing.json        # bundled pricing snapshot
│   │   ├── openai.ts, openai-protocol.ts
│   │   ├── anthropic.ts
│   │   ├── ollama.ts, ollama-cloud.ts, ollama-models.ts
│   │   ├── openrouter.ts
│   │   ├── opencode.ts
│   │   ├── zai.ts
│   │   ├── clinepass.ts              # live model lookup (ADR-013)
│   │   └── index.ts
│   │
│   ├── mcp/                          # Model Context Protocol
│   │   ├── client.ts                 # single-server client
│   │   ├── manager.ts                # multi-server lifecycle
│   │   ├── types.ts                  # MCP types + error envelope
│   │   └── index.ts
│   │
│   ├── skills/                       # agentskills.io implementation
│   │   ├── parser.ts                 # YAML frontmatter + body
│   │   ├── loader.ts                 # directory walk + SKILL.md discovery
│   │   ├── builtin-registry.ts       # bundled builtin skills
│   │   ├── prompt.ts                 # prompt-grounding helpers
│   │   ├── signature.ts              # skill identity (name/version)
│   │   ├── types.ts
│   │   ├── index.ts
│   │   ├── embedded-content.ts       # GENERATED; bundled skill markdown
│   │   └── builtin/
│   │       └── code-simplifier/SKILL.md
│   │
│   ├── ui/                           # Ink (React) CLI UI
│   │   ├── App.tsx                   # root component
│   │   ├── index.ts
│   │   ├── components/               # Header, MessageList, ChatLayout, StatusLine,
│   │   │                             # CommandMenu, ModelPicker, SkillPicker, ToolCall,
│   │   │                             # ToolOutput, TextInput, ToastList, etc.
│   │   ├── contexts/                 # Chat, Toast, StatusLine
│   │   ├── hooks/                    # useCommandHandler
│   │   ├── utils.ts
│   │   ├── errors/                   # chat-errors
│   │   ├── types/                    # enums
│   │   └── config/                   # constants
│   │
│   ├── config/                       # runtime config
│   │   ├── schema.ts                 # zod schema for config
│   │   ├── loader.ts                 # user + project config merge, env var interpolation
│   │   ├── config-io.ts              # readConfigFile/writeConfigFile (YAML/JSON, 0o600)
│   │   └── index.ts
│   │
│   ├── observability/                # tracing, logging, cost, redaction
│   │   ├── telemetry.ts              # OpenTelemetry tracing
│   │   ├── trace-context.ts          # traceId propagation
│   │   ├── token-usage.ts            # token counting
│   │   ├── cost.ts                   # cost estimation
│   │   ├── pricing.ts                # pricing data loader
│   │   ├── model-pricing.json        # bundled pricing snapshot
│   │   ├── redact.ts                 # secret redaction
│   │   ├── logger.ts                 # structured logger (pino)
│   │   ├── langfuse.ts               # Langfuse integration
│   │   ├── timer.ts                  # latency tracking
│   │   └── index.ts
│   │
│   └── utils/                        # tiny cross-cutting helpers
│       ├── command.ts                # CLI arg parsing
│       ├── retry.ts                  # retry with backoff
│       ├── version.ts                # generated-version consumer
│       ├── version-constant.ts       # GENERATED from package.json
│       └── xml.ts                    # XML parsing helpers
│
├── test/                             # bun:test suites, mirrors src/
│   ├── agents/                       # plan-agent, build-agent, step-executor, plan-grammar, state, explore
│   ├── cli/                          # main, upgrade, chat-commands, integration, handlers/*
│   ├── core/                         # agent, turn-executor, memory, conversation, ...
│   ├── tools/                        # bash, file, registry, search, skill, plugin
│   ├── providers/                    # openai, anthropic, ollama, model-registry, clinepass
│   ├── mcp/                          # manager, mcp-errors
│   ├── observability/                # telemetry, cost, logger, redact, token-usage, ...
│   ├── skills/                       # parser, loader, prompt, builtin-registry
│   ├── security/                     # command-injection, file-validation, bash-env
│   ├── config/                       # config-io, loader
│   ├── utils/                        # command, xml
│   ├── performance/                  # benchmarks
│   ├── e2e/                          # agent-loop integration
│   ├── ui/                           # ink UI smoke tests
│   └── agent.test.ts, memory.test.ts, ...
│
├── scripts/
│   ├── generate-embedded-skills.ts   # walk src/skills/builtin → embedded-content.ts
│   ├── generate-version.ts           # package.json → src/utils/version-constant.ts
│   └── install.sh                    # install helper
│
├── docs/
│   ├── README.md                     # docs landing page + ADR index
│   ├── adr/                          # Architecture Decision Records (001-014)
│   └── development-tasks.md          # current sprint / WIP tasks
│
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                    # typecheck + lint + tests + build
│   │   └── release.yml               # release pipeline
│   └── homebrew-tiny-agent/
│       └── tiny-agent.rb             # Homebrew formula
│
├── .planning/                        # this codebase map
│   └── codebase/                     # STACK, ARCHITECTURE, STRUCTURE, CONVENTIONS, TESTING, INTEGRATIONS, CONCERNS
│
├── .husky/
│   └── pre-commit                    # runs prek (biome + tsc)
│
└── .agents/                          # lifecycle scripts
    ├── resume
    └── setup
```

## Naming Conventions

- **Files**: kebab-case (`build-agent.ts`, `plan-grammar.ts`, `config-io.ts`).
- **Classes / types / React components**: PascalCase.
- **Functions / variables**: camelCase.
- **Constants**: SCREAMING_SNAKE_CASE.
- **Private members**: `_prefixed` (e.g. `_registry`, `_promptFn`).
- **Test files**: mirror source path with `.test.ts` suffix (`src/agents/build-agent.ts` → `test/agents/build-agent.test.ts`).

## Key Locations Cheat-Sheet

| Goal | File |
|---|---|
| Add a new tool | `src/tools/<name>.ts` + register in `src/tools/index.ts` |
| Add a new provider | `src/providers/<name>.ts` + wire into `factory.ts` + `model-registry.ts` |
| Add a CLI subcommand | `src/cli/handlers/<cmd>.ts` + register in `src/cli/main.tsx` |
| Add a chat `/command` | `src/cli/chat-commands.ts` + `src/ui/hooks/useCommandHandler.ts` + `src/ui/components/CommandMenu.tsx` |
| Add a skill | drop `SKILL.md` under `src/skills/builtin/<name>/` and run `bun run generate:skills` |
| Change plan format | `src/agents/plan-grammar.ts` (must keep `serialize`/`parse`/`validate` round-trip) |
| Change agent loop | `src/core/agent.ts` (main loop) + `src/core/turn-executor.ts` (tool dispatch) |
| Change step execution | `src/agents/step-executor.ts` (retry/skip/abort) + `src/agents/build-agent.ts` (orchestration) |
| Change Ink UI | `src/ui/components/` or `src/ui/App.tsx` |
| Change config I/O | `src/config/config-io.ts` (read/write) + `src/config/loader.ts` (loading/merge) |
| Add observability event | `src/observability/telemetry.ts` |
| Prompt user input | `src/cli/prompt.ts` (prompt / promptHidden / promptChoice) |
| Build a wired Agent | `src/cli/shared.ts` → `createAgent(config, options)` |
