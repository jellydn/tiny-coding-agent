# Structure

```
/Users/huynhdung/src/tries/2026-01-13-tiny-coding-agent
├── index.ts                          # CLI entry, arg parsing → agent loop / --upgrade
├── package.json                      # scripts, deps, release metadata
├── tsconfig.json                     # strict TS, ESM, paths (@/*)
├── biome.json                        # lint + format
├── Justfile                          # task runner recipes (dev/build/test/lint/release)
├── Makefile                          # legacy wrapper
├── cspell.json                       # spell-check dictionary
├── renovate.json                     # dep update automation
├── bun.lock                          # bun lockfile
├── AGENTS.md                         # contributor conventions (kebab-case, ESM, etc.)
├── CLAUDE.md                         # Claude-specific notes
├── SECURITY.md                       # security policy
├── README.md / RELEASE.md            # user-facing docs
│
├── src/
│   ├── cli/                          # CLI dispatch + per-feature handlers
│   │   ├── main.tsx                  # Ink app mount
│   │   ├── chat-commands.ts          # /-slash command parser
│   │   ├── shared.ts                 # shared CLI types
│   │   ├── status-line.ts
│   │   ├── index.ts
│   │   └── handlers/
│   │       ├── agent.ts, plan.ts, state.ts, memory.ts
│   │       ├── config.ts, mcp.ts, skill.ts, trace.ts
│   │       ├── status.ts, upgrade.ts
│   │
│   ├── core/                         # agent loop primitives
│   │   ├── agent.ts                  # main loop
│   │   ├── memory.ts                 # persistent memory store
│   │   ├── tokens.ts                 # token counting / budget
│   │   └── index.ts
│   │
│   ├── agents/                       # multi-agent system
│   │   ├── plan-agent.ts             # LLM-driven plan generation
│   │   ├── build-agent.ts            # plan execution via ToolRegistry
│   │   ├── explore-agent.ts          # read-only recon
│   │   ├── plan-grammar.ts           # canonical plan format (deep module)
│   │   ├── state.ts                  # atomic .tiny-state.json reader/writer
│   │   ├── types.ts                  # StateFile, StateError, etc.
│   │   └── plan-grammar.ts           # serialize/parse/validate/exampleOutput
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
│   │   ├── factory.ts                # model-string → provider
│   │   ├── capabilities.ts           # per-model capability matrix
│   │   ├── model-registry.ts         # in-memory model catalog
│   │   ├── models-dev.ts             # fetch from models.dev JSON
│   │   ├── model-pricing.json        # bundled pricing snapshot
│   │   ├── openai.ts, openai-protocol.ts
│   │   ├── anthropic.ts
│   │   ├── ollama.ts, ollama-cloud.ts, ollama-models.ts
│   │   ├── openrouter.ts
│   │   ├── opencode.ts
│   │   ├── zai.ts
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
│   │   ├── components/               # Header, MessageList, ChatLayout, ...
│   │   ├── contexts/                 # Chat, Toast, StatusLine
│   │   ├── hooks/
│   │   ├── utils.ts
│   │   ├── errors/
│   │   ├── types/
│   │   └── config/
│   │
│   ├── config/                       # runtime config
│   │   ├── schema.ts                 # zod schema for tiny-agent.json
│   │   ├── loader.ts                 # user + project config merge
│   │   └── index.ts
│   │
│   ├── observability/                # tracing, logging, cost, redaction
│   │   ├── telemetry.ts
│   │   ├── trace-context.ts
│   │   ├── token-usage.ts
│   │   ├── cost.ts
│   │   ├── pricing.ts
│   │   ├── redact.ts
│   │   ├── logger.ts
│   │   ├── langfuse.ts
│   │   ├── timer.ts
│   │   ├── model-pricing.json
│   │   └── index.ts
│   │
│   ├── utils/                        # tiny cross-cutting helpers
│   │   ├── command.ts                # CLI arg parsing
│   │   ├── retry.ts
│   │   ├── version.ts                # generated-version consumer
│   │   ├── version-constant.ts       # GENERATED from package.json
│   │   └── xml.ts
│   │
│   └── index.ts                      # src barrel (if any)
│
├── test/                             # bun:test suites, mirrors src/
│   ├── agents/                       # plan-agent, build-agent, plan-grammar, state, explore
│   ├── cli/                          # main, upgrade, chat-commands, integration, handlers/*
│   ├── core/                         # agent, memory, conversation, ...
│   ├── tools/                        # bash, file, registry, search, skill, plugin
│   ├── providers/                    # openai, anthropic, ollama, model-registry
│   ├── mcp/                          # manager, mcp-errors
│   ├── observability/                # telemetry, cost, logger, redact, ...
│   ├── skills/                       # parser, loader, prompt, builtin-registry
│   ├── security/                     # command-injection, file-validation, bash-env
│   ├── config/                       # loader
│   ├── utils/                        # command, xml
│   ├── performance/                  # benchmarks
│   ├── e2e/                          # agent-loop integration
│   ├── ui/                           # ink UI smoke tests
│   └── agent.test.ts, memory.test.ts, openai-provider.test.ts, anthropic-provider.test.ts
│
├── scripts/
│   ├── generate-embedded-skills.ts   # walk src/skills/builtin → embedded-content.ts
│   ├── generate-version.ts           # package.json → src/utils/version-constant.ts
│   └── install.sh                    # install helper
│
├── docs/
│   ├── README.md
│   ├── adr/                          # Architecture Decision Records (001-011)
│   └── development-tasks.md
│
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                    # typecheck + lint + tests + build
│   │   └── release.yml               # release pipeline
│   └── homebrew-tiny-agent/
│
├── .planning/                        # this map lives here (codemap output)
│
├── .freebuff/                        # local-only Freebuff runtime DB
│
├── .husky/
│   └── pre-commit
│
└── .agents/                          # lifecycle scripts (resume, setup)
    ├── resume
    └── setup
```

## Naming Conventions

- **Files**: kebab-case (`build-agent.ts`, `plan-grammar.ts`).
- **Classes / types / React components**: PascalCase.
- **Functions / variables**: camelCase.
- **Constants**: SCREAMING_SNAKE_CASE.
- **Private members**: `_prefixed`.
- **Test files**: mirror source path with `.test.ts` suffix (`src/agents/plan-agent.ts` → `test/agents/plan-agent.test.ts`).

## Key Locations Cheat-Sheet

| Goal | File |
|---|---|
| Add a new tool | `src/tools/<name>.ts` + register in `src/tools/index.ts` |
| Add a new provider | `src/providers/<name>.ts` + wire into `factory.ts` + `model-registry.ts` |
| Add a CLI subcommand | `src/cli/handlers/<cmd>.ts` + register in `src/cli/main.tsx` |
| Add a skill | drop `SKILL.md` under `src/skills/builtin/<name>/` and run `bun run generate:skills` |
| Change plan format | `src/agents/plan-grammar.ts` (must keep `serialize`/`parse`/`validate` round-trip) |
| Change agent loop | `src/core/agent.ts` |
| Change Ink UI | `src/ui/components/` or `src/ui/App.tsx` |
| Add observability event | `src/observability/telemetry.ts` |
