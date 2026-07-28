# Docs

This directory holds durable documentation for `tiny-coding-agent`.

## Architecture Decision Records (ADRs)

ADRs capture *why* a decision was made, what alternatives were considered, and what the consequences are. They live in [`adr/`](adr/) and are numbered sequentially.

| # | Title | Summary |
|---|---|---|
| 001 | [Project architecture](adr/001-project-architecture.md) | Overall layering and module boundaries. |
| 002 | [LLM provider abstraction](adr/002-llm-provider-abstraction.md) | Why providers sit behind a common interface. |
| 003 | [MCP client implementation](adr/003-mcp-client-implementation.md) | Adopting Model Context Protocol. |
| 004 | [Context management handoff](adr/004-context-management-handoff.md) | When the agent hands off context between turns. |
| 005 | [Tool system design](adr/005-tool-system-design.md) | `Tool` interface, registry, dangerous-routing. |
| 006 | [Plugin system](adr/006-plugin-system.md) | Drop-in `.ts` plugins under `~/.tiny-agent/plugins/`. |
| 007 | [Model registry pattern](adr/007-model-registry-pattern.md) | Single source of truth for model capabilities and pricing. |
| 008 | [Memory system](adr/008-memory-system.md) | Persistent memory store and lifetime. |
| 009 | [Tool confirmation](adr/009-tool-confirmation.md) | How dangerous ops get user confirmation before execution. |
| 010 | [Ink CLI integration](adr/010-ink-cli-integration.md) | Why the CLI UI is React/Ink and how state flows. |
| 011 | [Multi-agent system](adr/011-multi-agent-system.md) | plan / build / explore agents sharing a state file and `PlanGrammar`. |
| 012 | [GatewayOpenAIProvider base class](adr/012-gateway-openai-provider-base.md) | Held back by the 30% duplication threshold — keep providers inline. |
| 013 | [ClinePass live model lookup](adr/013-clinepass-live-model-lookup.md) | Replace baked capability table with a live `GET /api/v1/models` fetch. |
| 014 | [Login command onboarding design](adr/014-login-command.md) | Top-level command before `loadConfig`; chat `/login` status-only; literal key storage with env-var tip. |
| 015 | [Lifecycle hooks system](adr/015-lifecycle-hooks-system.md) | External command spawning at 3 lifecycle events; plannotator preset; sequential pipeline. |
| 016 | [Agent decomposition](adr/016-agent-decomposition.md) | Extract 10 focused modules from the agent.ts monolith via the deletion test + type-only imports. |

## Other Docs

- [`development-tasks.md`](development-tasks.md) — current sprint / WIP tasks.

## Related, Outside `docs/`

- [`../AGENTS.md`](../AGENTS.md) — contributor conventions (naming, imports, error handling, testing).
- [`../CLAUDE.md`](../CLAUDE.md) — Claude-specific notes for sessions in this repo.
- [`../.planning/codebase/`](../.planning/codebase/) — generated codebase map (`STACK.md`, `ARCHITECTURE.md`, `STRUCTURE.md`, `CONVENTIONS.md`, `TESTING.md`, `INTEGRATIONS.md`, `CONCERNS.md`).
