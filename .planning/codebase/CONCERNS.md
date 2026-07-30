# Technical Concerns

## Pre-existing Test Failures (~66)
Environment-dependent failures across security sandbox, shell env filtering, config override, and explore agent tests. These fail on clean `main` and are not caused by recent changes. See `TESTING.md` for categories.

## Largest Source Files (Round 7 targets)
| File | Lines | Concern |
|------|-------|---------|
| `src/core/agent.ts` | 672 | +31 lines for tool categorization; runStream observability spans scattered |
| `src/ui/hooks/useCommandHandler.ts` | 450 | ChatCommandRegistry extracted, handler logic remains |
| `src/agents/plan-grammar.ts` | 437 | Grammar parser/validator — untouched |
| `src/core/memory.ts` | 401 | SignalHandlerManager extracted, still 401 lines |
| `src/agents/codebase-explorer.ts` | 381 | Explore agent — untouched |
| `src/providers/anthropic.ts` | 370 | Provider implementation — duplicated patterns across 8 providers |
| `src/tools/search-tools.ts` | 354 | Glob/grep formatting duplication |
| `src/cli/handlers/login-flow.ts` | 346 | Login flow — untouched |
| `src/tools/file-tools.ts` | 326 | Validation helpers extracted to file-utils.ts (was 449) |
| `src/core/agent-observability.ts` | 326 | Telemetry wrapper |
| `src/config/loader.ts` | 324 | 4 concerns mixed in one module |

## Typecheck Issue
- `error TS2688: Cannot find type definition file for '@types/bun'` — pre-existing on this machine. `@types/bun` not resolved correctly. Does not affect CI.

## Biome Config Staleness
- `biome.json` uses schema `2.3.12` but CLI is `2.5.4` — 2 pre-existing infos on every run
- The `recommended` linter field is deprecated; should migrate to `preset`
- Run `biome migrate` to fix

## Architecture Debt (Resolved)
- ✅ Agent.ts decomposed from 950→672 lines (Rounds 1-5 + tool categorization)
- ✅ main.tsx decomposed from 541→288 lines
- ✅ login.ts decomposed from 604→~100 lines
- ✅ tool status helpers unified across 3 files
- ✅ plan parsing extracted from build-agent.ts
- ✅ Syntax highlighting extracted from Message.tsx
- ✅ signal-handler-manager.ts extracted from memory.ts
- ✅ ModelPicker model data extracted into model-data.ts (380→~159 lines)
- ✅ file-tools validation helpers extracted into file-utils.ts (449→326 lines)

## ByteByteGo Optimization Opportunities (Issue #86 — Closed)
All items completed, issue #86 closed.
- ✅ **Stable prompt prefix** — tools sorted alphabetically (commit `939207d`)
- ✅ **Incremental context** — ADR-017 design doc (PR #95)
- ✅ **Deferred tool discovery** — ADR-018 design doc + Option A implemented (PR #99, #96)
- ✅ **Code mode** — ADR-019 design doc (PR #97)

## Round 7 Architecture Candidates
| # | Candidate | Files | Strength |
|---|-----------|-------|----------|
| 1 | Extract shared provider helpers | anthropic.ts, ollama.ts, openai.ts → provider-utils.ts | 🟢 Strong |
| 2 | Extract RunnerObservability from runStream() | agent.ts (672) → runner-observability.ts | 🟢 Strong |
| 3 | Extract config template + validation | loader.ts (324) → config-template.ts, config-validator.ts | 🟡 Worth exploring |
| 4 | Extract MCP initialization from shared.ts | shared.ts (280) → mcp-setup.ts | 🟡 Worth exploring |
| 5 | Extract formatting helpers from search-tools.ts | search-tools.ts (354) → search-utils.ts | 🟠 Speculative |

**Top recommendation:** Candidate #1 — 8 provider files all duplicate `convertMessages()`, `convertTools()`, `extractUsage()`, and capabilities caching. A shared `provider-utils.ts` would cut each provider by ~40-50 lines.

## New Modules (Round 6)
| Module | Lines | Extracted From |
|--------|-------|----------------|
| `src/ui/model-data.ts` | 207 | ModelPicker.tsx (80+ model definitions) |
| `src/tools/file-utils.ts` | 128 | file-tools.ts (path validation helpers) |
| `src/core/signal-handler-manager.ts` | 51 | memory.ts (signal handler registration) |
Tool categorization added to `agent.ts` (+31 lines): `CORE_TOOLS` set + `inferRelevantCategories()` heuristic + filtered tool array in runStream().

## Single TODO in Source
```
src/ui/hooks/useCommandHandler.ts:194
`**TODO** (${pendingSteps.length} pending)\n\n${todoList}`
```
This is a feature TODO display in the chat UI, not a code debt item.
