# Technical Concerns

## Pre-existing Test Failures (~66)
Environment-dependent failures across security sandbox, shell env filtering, config override, and explore agent tests. These fail on clean `main` and are not caused by recent changes. See `TESTING.md` for categories.

## Largest Source Files (Round 6 candidates)
| File | Lines | Concern |
|------|-------|---------|
| `src/core/agent.ts` | 643 | Still largest despite 5 rounds of extraction |
| `src/ui/hooks/useCommandHandler.ts` | 450 | ChatCommandRegistry extracted, handler logic remains |
| `src/tools/file-tools.ts` | 449 | Multi-tool module, untested areas |
| `src/agents/plan-grammar.ts` | 437 | Grammar parser/validator — untouched |
| `src/core/memory.ts` | 422 | SignalHandlerManager extracted, still 422 lines |
| `src/ui/components/ModelPicker.tsx` | 380 | ~200 lines static model data mixed with logic |
| `src/providers/anthropic.ts` | 370 | Provider implementation |

## Typecheck Issue
- `error TS2688: Cannot find type definition file for '@types/bun'` — pre-existing on this machine. `@types/bun` not resolved correctly. Does not affect CI.

## Biome Config Staleness
- `biome.json` uses schema `2.3.12` but CLI is `2.5.4` — 2 pre-existing infos on every run
- The `recommended` linter field is deprecated; should migrate to `preset`
- Run `biome migrate` to fix

## Architecture Debt (Resolved)
- ✅ Agent.ts decomposed from 950→643 lines (Rounds 1-5)
- ✅ main.tsx decomposed from 541→288 lines
- ✅ login.ts decomposed from 604→~100 lines
- ✅ tool status helpers unified across 3 files
- ✅ plan parsing extracted from build-agent.ts
- ✅ Syntax highlighting extracted from Message.tsx
- ⏳ signal-handler-manager.ts (PR #87, draft — last Round 5 extraction pending merge)

## ByteByteGo Optimization Opportunities (Issue #86)
- ✅ **Stable prompt prefix** — tools sorted alphabetically (commit `939207d`)
- 🔲 **Incremental context** — send only new tool output + response ID
- 🔲 **Deferred tool discovery** — lazy MCP tool registration
- 🔲 **Code mode** — parallel tool execution via model-written JS

## Single TODO in Source
```
src/ui/hooks/useCommandHandler.ts:194
`**TODO** (${pendingSteps.length} pending)\n\n${todoList}`
```
This is a feature TODO display in the chat UI, not a code debt item.
