# Technical Concerns

## Pre-existing Test Failures (~66)
Environment-dependent failures across security sandbox, shell env filtering, config override, and explore agent tests. These fail on clean `main` and are not caused by recent changes. See `TESTING.md` for categories.

## Largest Source Files (Round 8 targets)
| File | Lines | Concern |
|------|-------|---------|
| `src/ui/hooks/useCommandHandler.ts` | 450 | ChatCommandRegistry extracted, handler logic remains |
| `src/agents/plan-grammar.ts` | 437 | Grammar parser/validator — untouched |
| `src/core/memory.ts` | 401 | SignalHandlerManager extracted, still 401 lines |
| `src/agents/codebase-explorer.ts` | 381 | Explore agent — untouched |
| `src/cli/handlers/login-flow.ts` | 346 | Login flow — untouched |
| `src/tools/file-tools.ts` | 326 | Validation helpers extracted to file-utils.ts (was 449) |
| `src/core/agent-observability.ts` | 326 | Telemetry wrapper |
| `src/config/loader.ts` | 270 | Template extracted; env-var interpolation remains (~110 lines) |
| `src/core/agent.ts` | 610 | RunnerObservability extracted (was 672) |
| `src/providers/anthropic.ts` | 355 | Provider helpers extracted (was 370) |
| `src/tools/search-tools.ts` | 310 | Search utilities extracted (was 354) |

## Typecheck Issue
- `error TS2688: Cannot find type definition file for '@types/bun'` — pre-existing on this machine. `@types/bun` not resolved correctly. Does not affect CI.

## Biome Config Staleness
- `biome.json` uses schema `2.3.12` but CLI is `2.5.4` — 2 pre-existing infos on every run
- The `recommended` linter field is deprecated; should migrate to `preset`
- Run `biome migrate` to fix

## Architecture Debt (Resolved)
- ✅ Agent.ts decomposed from 950→610 lines (Rounds 1-7 + tool categorization + RunnerObservability)
- ✅ main.tsx decomposed from 541→288 lines
- ✅ login.ts decomposed from 604→~100 lines
- ✅ tool status helpers unified across 3 files
- ✅ plan parsing extracted from build-agent.ts
- ✅ Syntax highlighting extracted from Message.tsx
- ✅ signal-handler-manager.ts extracted from memory.ts
- ✅ ModelPicker model data extracted into model-data.ts (380→~159 lines)
- ✅ file-tools validation helpers extracted into file-utils.ts (449→326 lines)
- ✅ Provider helpers extracted into provider-utils.ts (5 providers simplified)
- ✅ RunnerObservability extracted from agent.ts runStream()
- ✅ Config template extracted into config-template.ts
- ✅ MCP setup extracted into mcp-setup.ts
- ✅ Search utilities extracted into search-utils.ts

## ByteByteGo Optimization Opportunities (Issue #86 — Closed)
All items completed, issue #86 closed.
- ✅ **Stable prompt prefix** — tools sorted alphabetically (commit `939207d`)
- ✅ **Incremental context** — ADR-017 design doc (PR #95)
- ✅ **Deferred tool discovery** — ADR-018 design doc + Option A implemented (PR #99, #96)
- ✅ **Code mode** — ADR-019 design doc (PR #97)

## Round 7 Architecture Candidates (All Complete ✅)
| # | Candidate | Merged PR | Status |
|---|-----------|-----------|--------|
| 1 | Extract shared provider helpers → provider-utils.ts | #100 | ✅ Done |
| 2 | Extract RunnerObservability from runStream() | #107 | ✅ Done |
| 3 | Extract config template → config-template.ts | #101 | ✅ Done |
| 4 | Extract MCP initialization → mcp-setup.ts | #105 | ✅ Done |
| 5 | Extract search helpers → search-utils.ts | #106 | ✅ Done |

## New Modules (Rounds 6 & 7)
| Module | Lines | Extracted From |
|--------|-------|----------------|
| `src/ui/model-data.ts` | 207 | ModelPicker.tsx (80+ model definitions) |
| `src/tools/file-utils.ts` | 128 | file-tools.ts (path validation helpers) |
| `src/core/signal-handler-manager.ts` | 51 | memory.ts (signal handler registration) |
| `src/providers/provider-utils.ts` | 90 | 5 providers (num, buildTokenUsage, capabilitiesWithCatalogFallback) |
| `src/core/runner-observability.ts` | 89 | agent.ts runStream() (scattered observability blocks) |
| `src/config/config-template.ts` | 52 | loader.ts (default YAML template) |
| `src/cli/mcp-setup.ts` | 65 | shared.ts (MCP server initialization) |
| `src/tools/search-utils.ts` | 73 | search-tools.ts (glob matching, result formatting) |
Tool categorization added to `agent.ts` (+31 lines): `CORE_TOOLS` set + `inferRelevantCategories()` heuristic + filtered tool array in runStream().

## Single TODO in Source
```
src/ui/hooks/useCommandHandler.ts:194
`**TODO** (${pendingSteps.length} pending)\n\n${todoList}`
```
This is a feature TODO display in the chat UI, not a code debt item.
