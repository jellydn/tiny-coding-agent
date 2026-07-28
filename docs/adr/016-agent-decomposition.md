# ADR-016: Agent Decomposition — Extracting Focused Modules from the `agent.ts` Monolith

**Status:** Accepted
**Date:** 2026-07-28
**Deciders:** huynhdung

## Context

`src/core/agent.ts` was the #1 hot spot in the codebase: 1173 lines, 4 recent changes, and a single `runStream()` method of ~400 lines that interleaved 6+ concerns — observability instrumentation, context budgeting, the LLM streaming loop, tool-call batching, loop detection, error recovery, and verbose logging. Testing any single concern (e.g. "does loop detection break correctly?") required setting up the entire `Agent` with a real or mock LLM client, tool registry, and memory store.

A parallel problem existed in `src/cli/main.tsx` (agent construction duplicated between `handleRun` and `handleInteractiveChat`) and `src/agents/build-agent.ts` (200-line function interleaving plan parsing, state I/O, tool execution, and error recovery).

The architecture review (via the `improve-codebase-architecture` skill) identified 5 deepening candidates, ranked by payoff. This ADR records the decisions behind the extractions that were implemented.

## Decision

**Decompose the monolith into focused, independently testable modules using the "deletion test" as the extraction criterion, with type-only imports to break circular dependencies.**

### 1. The deletion test as extraction criterion

Before extracting a module, apply the deletion test: *would deleting it concentrate complexity, or just move it?* A "yes, concentrates" is the signal to extract. This prevents speculative generality — modules that exist only for aesthetic separation without reducing real complexity.

All extractions in this decomposition passed the deletion test:

| Module | Extracted from | Lines | Deletion test result |
|--------|---------------|-------|---------------------|
| `TurnExecutor` | `agent.ts` runStream() | 236 | Deleting pushes tool-execution + error-recovery logic back into the 400-line method — concentrates. |
| `AgentObservability` | `agent.ts` runStream() | 326 | Deleting pushes 46 cross-cutting span/timer calls back into business logic — concentrates. |
| `agent-utils.ts` | `agent.ts` + `turn-executor.ts` | 228 | Deleting recreates the circular import between agent.ts and turn-executor.ts — concentrates. |
| `context-budget.ts` | `memory.ts` | 174 | Deleting pushes budgeting logic back into the data layer, recreating the data→orchestration→data cycle — concentrates. |
| `ChatCommandRegistry` | `useCommandHandler.ts` | 77 | Deleting pushes 12-case switch + alias resolution + help-text generation back into the hook — concentrates. |
| `command-dispatch.ts` | `main.tsx` | 265 | Deleting pushes 15-case command dispatch back into the CLI entry point — concentrates. |
| `StepExecutor` | `build-agent.ts` | 217 | Deleting pushes execute/retry/skip/abort flow back into the 200-line function — concentrates. |
| `CodebaseExplorer` | `explore-agent.ts` + `plan-agent.ts` | 381 | Deleting recreates 4 duplicate ToolRegistry instances + N+1 file reads — concentrates. |
| `DebugLogger` | `agent.ts` runStream() | 132 | Deleting pushes 6 conditional logging branches back into business logic — concentrates. |
| `ProviderCache` | `agent.ts` | ~120 | Deleting pushes cache Map + eviction + provider detection back into Agent — concentrates. |

**Rationale:** The deletion test is more reliable than "it looks long" or "it has multiple responsibilities." A module that passes the deletion test has real leverage — future changes to that concern are a one-file change instead of a hunt through a monolith.

### 2. Type-only imports to break circular dependencies

Several extractions create potential circular imports:

- `context-budget.ts` needs `ContextStats` from `memory.ts`, but `memory.ts` doesn't import from `context-budget.ts` — no cycle, but the import direction was reversed (data layer importing from orchestration).
- `agent-utils.ts` needs types from `agent.ts`, but `agent.ts` imports from `agent-utils.ts` — a real cycle.
- `DebugLogger` needs `ContextStats` from `memory.ts` and `ProviderConfig` from `config/schema.ts` — no cycle, but the pattern is established for consistency.

**Decision:** Use `import type { ... }` for all cross-module type references in extracted modules. TypeScript erases type-only imports at compile time, so there is no runtime dependency. This is enforced by the project's `verbatimModuleSyntax` compiler option.

```typescript
// context-budget.ts — type-only import, no runtime cycle
import type { ContextStats, Memory, MemoryStore } from "./memory.js";
```

**Rationale:** Type-only imports are the simplest way to break a cycle without introducing a shared types module (which would be a third file for every pair). The `verbatimModuleSyntax` flag ensures the intent is explicit — `import type` vs `import` is a deliberate choice, not an accident.

### 3. Re-exports for backward compatibility

Extracted functions that were previously exported from their original module are re-exported for backward compatibility:

```typescript
// agent.ts — re-export for tests and external consumers
export { isLooping, streamLlmResponse, truncateOutput } from "./agent-utils.js";
export type { ProviderConfigs } from "./provider-cache.js";
```

**Rationale:** Tests and other modules import from the original location. Re-exports avoid a shotgun-surgery rename across dozens of test files. The re-export is a one-line addition; the cost of updating all import sites would be high and the benefit zero (the function signatures are unchanged).

### 4. Intentional duplication to avoid cycles

`DebugLogger` has its own `redactKey()` helper that duplicates the logic of `redactApiKey()` in `agent.ts`:

```typescript
// debug-logger.ts — own copy to avoid circular import
function redactKey(key?: string): string {
    if (!key) return "(not set)";
    if (key.length <= 8) return "****";
    return `${key.slice(0, 4)}...REDACTED`;
}
```

**Rationale:** `agent.ts` imports `DebugLogger`, so `DebugLogger` cannot import from `agent.ts` at runtime. Moving `redactApiKey` to a third utility module would be over-engineering for a 4-line function. The duplication is documented in the code comments and is the lesser evil compared to a circular import or a new shared module for one tiny function.

### 5. No-op pattern for cross-cutting concerns

`DebugLogger` and `AgentObservability` both use a no-op pattern: when the feature is disabled (verbose=false, observability undefined), every method is a no-op — zero overhead, no conditional branches in the caller.

```typescript
// DebugLogger — no-op when verbose is false
logIteration(iteration: number, contextStats: ContextStats, track: boolean): void {
    if (!this._verbose) return;  // early return, no work
    // ... logging logic ...
}
```

**Rationale:** This eliminates the `if (this._verbose) { ... }` conditional branches that were scattered through `runStream()`. The caller calls `this._debug.logIteration(...)` unconditionally; the logger decides whether to do anything. This is the Strategy pattern with a no-op strategy — simpler than conditional injection and zero-cost when disabled.

## Consequences

### Positive

- **Testability:** Each extracted module can be tested in isolation with mock dependencies — no full Agent setup required. `TurnExecutor` tests use a mock `ToolRegistry`; `DebugLogger` tests verify console output directly; `ProviderCache` tests use a mock default client.
- **Locality:** "What happens in one turn" lives in `TurnExecutor`, "how to safely read/write config" lives in `config-io.ts`, "how to prompt the user" lives in `prompt.ts". Future changes to a concern are a one-file change.
- **Readability:** `runStream()` is now a readable orchestration loop — the business logic is visible without wading through 46 observability calls and 6 logging branches.
- **Leverage:** Adding a new error-recovery path (e.g. rate-limit retry) is a change to `TurnExecutor`, not a hunt through 400 lines. Adding a new chat command is a one-entry addition to `ChatCommandRegistry`, not a new case in a switch + a new entry in a hardcoded array + a new line in help text.
- **Circular dependency elimination:** The `agent.ts ↔ turn-executor.ts` cycle is broken by `agent-utils.ts`. The `memory.ts → agent.ts` conceptual cycle is broken by `context-budget.ts`.

### Negative

- **More files to navigate:** 10 new modules means 10 more files in the tree. A new contributor must understand the module boundaries before making changes. The `.planning/codebase/ARCHITECTURE.md` diagram and this ADR mitigate this.
- **Intentional duplication:** `redactKey` in `DebugLogger` duplicates `redactApiKey` in `agent.ts`. This is a 4-line function — the cost of a shared module would exceed the benefit.
- **Re-export indirection:** Tests that import `isLooping` from `agent.ts` now get it via a re-export from `agent-utils.ts`. A reader following the import chain makes one extra hop. This is acceptable — the alternative (updating all import sites) has no benefit.

### Trade-offs

- **Extraction vs. inline:** Every extraction adds a file, an import, and a module boundary. The deletion test ensures the extraction concentrates complexity rather than just moving it. Modules that would not pass the deletion test (e.g. a hypothetical "MessageBuilder" that just wraps `messages.push()`) were not extracted.
- **Type-only imports vs. shared types module:** Type-only imports are per-module and explicit. A shared `types.ts` would centralize types but add a new module that every file imports from. The `verbatimModuleSyntax` flag makes the choice explicit and safe.
- **No-op pattern vs. conditional injection:** The no-op pattern is simpler (no dependency injection, no factory) but means the object is always allocated, even when the feature is disabled. For `DebugLogger` and `AgentObservability`, the allocation cost is negligible (one small object per Agent instance).

## Alternatives Considered

1. **Keep the monolith, add more tests.** Rejected — testing the monolith required mocking the entire Agent stack. The test friction was the primary driver, not the code length. Adding tests to a 1173-line file doesn't reduce the test setup cost.

2. **Extract a single "AgentInternals" module.** Rejected — this would create a new monolith with a different name. The decomposition is into *focused* modules (one concern each), not a reshuffling of the same code into a different file.

3. **Use dependency injection for all extracted modules.** Rejected — the Agent constructor already has 15+ options. Injecting `TurnExecutor`, `DebugLogger`, `AgentObservability`, `ProviderCache` as constructor params would push the count to 19+. The modules are constructed internally with sensible defaults; only `TurnExecutor` accepts an optional `verbose` flag for testing.

4. **Use a decorator/aspect pattern for observability.** Rejected — TypeScript decorators are an experimental feature and would add a new language concept to the codebase. The `AgentObservability` wrapper class achieves the same separation (business logic calls `this._obsWrapper.beginLlmCall()`, not `startSpan()`) without decorators.

5. **Defer all extractions until the codebase stabilizes.** Rejected — `agent.ts` was the #1 hot spot with 4 recent changes. The extraction payoff increases with change frequency, not decreases. Waiting would mean more changes accumulated in the monolith, making the eventual extraction harder.

## Implementation

**Merged to `main`** (8 modules — `agent.ts` reduced from 1173 to 844 lines):

- `src/core/turn-executor.ts` — per-iteration tool execution + error recovery.
- `src/core/agent-observability.ts` — all observability instrumentation (spans, timers, logs).
- `src/core/agent-utils.ts` — `isLooping()`, `truncateOutput()`, `streamLlmResponse()`, `streamFinalAnswer()`.
- `src/core/context-budget.ts` — `calculateContextBudget()`, `buildContextWithMemory()`, `prepareContext()`, `buildContextStats()`.
- `src/ui/chat-command-registry.ts` — declarative command registry, alias resolution, help-text generation.
- `src/cli/command-dispatch.ts` — 15-case CLI command dispatch table.
- `src/agents/step-executor.ts` — per-step action execution + retry/skip/abort recovery.
- `src/agents/codebase-explorer.ts` — shared ToolRegistry + file/glob/grep exploration logic.

**In pending PRs** (2 modules — will further reduce `agent.ts` once merged):

- `src/core/debug-logger.ts` — 6 verbose-logging methods, no-op when verbose=false. (PR #78)
- `src/core/provider-cache.ts` — provider client cache with eviction + health tracking. (uncommitted, branch `refactor/provider-cache`)

- `src/core/agent.ts` — currently 844 lines on `main` (down from 1173); will reach ~770 once the two pending extractions merge.

## Related Decisions

- **ADR-001: Project Architecture** — the overall layering. This decomposition is within the `src/core/` and `src/agents/` layers; it doesn't change the layer boundaries.
- **ADR-004: Context Management (Handoff)** — the context budgeting logic now lives in `context-budget.ts` instead of `memory.ts`, but the handoff semantics are unchanged.
- **ADR-005: Tool System Design** — the `ToolRegistry` pattern. `TurnExecutor` and `StepExecutor` both use the registry; they don't change its interface.
- **ADR-010: Ink CLI Integration** — the React/Ink UI architecture. `ChatCommandRegistry` is a data module imported by the UI hooks; it doesn't change the rendering architecture.
- **ADR-011: Multi-Agent System** — the state file and PlanGrammar. `StepExecutor` and `CodebaseExplorer` are within the build/explore agents; they don't change the state file contract.
- **ADR-012: GatewayOpenAIProvider Base Class** — the 30% duplication threshold for provider extraction. This ADR uses a different criterion (the deletion test) because the concern is complexity concentration, not duplication ratio. The two criteria are complementary: ADR-012 guards against premature abstraction in providers; this ADR guards against monolith accumulation in the agent loop.

## Future Considerations

- A `ContextBudget` class (not just functions) could encapsulate the budget state across turns, avoiding the `updateStats()` closure in `runStream()`. Low priority — the functions are already extracted and testable.
- `ProviderCache` could be shared across multiple `Agent` instances in a multi-agent session. Currently each Agent has its own cache; a session-level cache would reduce redundant provider client creation.
- The `command-dispatch.ts` table could be auto-generated from handler metadata (like `ChatCommandRegistry` generates help text). Currently the dispatch table is hand-maintained.
- `CodebaseExplorer` could be extended to support incremental exploration (only re-read changed files since last run). Currently it re-reads on every invocation.
