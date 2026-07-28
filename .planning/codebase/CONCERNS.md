# Technical Concerns

## Recently Resolved (PRs #61–#81)

The following extractions were completed between v0.6.0 and v0.7.0, consolidating duplicated patterns into deep modules:

| Module | File | Lines | PR | Eliminates |
|--------|------|-------|-----|------------|
| Config I/O | `src/config/config-io.ts` | 87 | #61 | 3-way config read/write duplication |
| CLI Prompt Helper | `src/cli/prompt.ts` | — | #62 | 3-way readline duplication |
| TurnExecutor | `src/core/turn-executor.ts` | 236 | #63 | Tool dispatch from `runStream()` |
| createAgent factory | `src/cli/shared.ts` | — | #64 | Duplicated agent construction in CLI |
| StepExecutor | `src/agents/step-executor.ts` | 217 | #65 | Build-agent step execution logic |
| AgentObservability | `src/core/agent-observability.ts` | 326 | #71 | 46 cross-cutting telemetry calls |
| streamLlmResponse | `src/core/agent-utils.ts` | 228 | #74 | Duplicate stream pattern |
| streamFinalAnswer | `src/core/agent-utils.ts` | — | #74 | Loop-detection final-answer block |
| ContextBudget | `src/core/context-budget.ts` | 276 | #72, #77 | Context budgeting from `memory.ts` |
| CommandDispatcher | `src/cli/command-dispatch.ts` | 265 | #72 | CLI command dispatch table from `main.tsx` |
| CodebaseExplorer | `src/agents/codebase-explorer.ts` | 381 | — | 4 duplicate `ToolRegistry` instances |
| ChatCommandRegistry | `src/ui/chat-command-registry.ts` | 77 | #76 | 12-case switch in `useCommandHandler` |
| DebugLogger | `src/core/debug-logger.ts` | 132 | #78 | 6 verbose-logging blocks from `runStream()` |
| ProviderCache | `src/core/provider-cache.ts` | 134 | #80 | Provider instance caching from `Agent` |
| StateManager | `src/agents/state-manager.ts` | 198 | #81 | 19 state I/O calls across 7 modules |
| createAgentClient | `src/agents/agent-client.ts` | 50 | #81 | 3-way `loadConfig→parseModelString→createProvider` duplication |
| SkillManager | `src/core/skill-manager.ts` | 158 | #82 | 4 skill fields + 8 methods from Agent |
| ToolDisplay | `src/cli/tool-display.tsx` | 156 | #82 | ~120 lines of display utilities from main.tsx |
| loadOrFail() | `src/agents/state-manager.ts` | — | #82 | Double-read pattern in 3 CLI handlers |

## Tech Debt

### 1. `agent.ts` Still 652 Lines After Decomposition

**File**: `src/core/agent.ts` (652 lines)
**Severity**: Low
**Status**: Improving (was 1,173 lines before ADR-016 extraction, now 652 after SkillManager extraction)

After extracting 12 modules (TurnExecutor, AgentObservability, DebugLogger, ProviderCache, context-budget, agent-utils, SkillManager, ToolDisplay, etc.), `agent.ts` dropped from 1,173 → 652 lines. The skill management concern was extracted into `SkillManager` (`src/core/skill-manager.ts`, 158 lines). Remaining concerns in agent.ts: the agent loop, conversation management, memory, and the public interface — all cohesive.

### 2. `login.ts` Has 16 `process.exit()` Calls

**File**: `src/cli/handlers/login.ts` (604 lines)
**Severity**: Medium
**Status**: Documented in ADR-014

The interactive login/logout flows call `process.exit()` 16 times, making them untestable without spawning a process. The pure functions (`applyProviderToConfig`, `removeApiKeyFromConfig`, `formatProviderStatus`) are well-extracted and tested, but the interactive flows (`loginProvider`, `logoutProvider`, `loginInteractive`, `logoutInteractive`) are not unit-testable.

### 3. `useCommandHandler.ts` 458 Lines with Inline Command Handlers

**File**: `src/ui/hooks/useCommandHandler.ts` (458 lines)
**Severity**: Low
**Status**: Partially refactored (ChatCommandRegistry extracted)

The `handleCommand` dispatcher was extracted into `chat-command-registry.ts` (77 lines), but the individual command handlers (`handleSkillCommand`, `handlePlanCommand`, `handleReviewCommand`, etc.) are still inline `useCallback` functions within the hook. Each handler is 30-80 lines of `onAddMessage` + `readStateFile` + business logic.

### 4. `main.tsx` Still Mixes CLI Entry Point + Streaming Loop

**File**: `src/cli/main.tsx` (405 lines)
**Severity**: Low
**Status**: Improving (ToolDisplay extracted — was 541 lines)

`main.tsx` now mixes 2 concerns (down from 3): (1) CLI entry-point orchestration (`main()`, arg parsing), and (2) the `handleRun` streaming loop. Tool display formatting (`ThinkingTagFilter`, `formatArgs`, `displayToolExecution`, `outputJson`) was extracted into `src/cli/tool-display.tsx` (156 lines). The remaining streaming loop in `handleRun` is ~90 lines and tightly coupled to the CLI entry point — further extraction would require a `RunHandler` abstraction, which is speculative at this point.

### 5. State File I/O — Resolved by `loadOrFail()`

**Files**: `src/cli/handlers/plan.ts`, `src/cli/handlers/agent.ts`, `src/ui/hooks/useCommandHandler.ts`
**Severity**: Resolved
**Status**: Merged (PR #82) — `loadOrFail()` eliminates double-read

The `StateManager` class (`src/agents/state-manager.ts`, 198 lines) consolidates 19 state I/O calls across 7 modules. The `loadOrFail()` method returns a discriminated union (`{ success: true, state } | { success: false, error, code }`) that lets CLI handlers replace the double-read pattern (`readStateFile()` check + `loadOrCreate()`) with a single call. Error messages preserved for backward compatibility. The `_state` unused variable (concern #6) was also eliminated — `loadOrFail()` returns the result inline.

### 6. ~~`_state` Unused Variable in useCommandHandler.ts~~ — Resolved

**Status**: Resolved by `loadOrFail()` extraction (PR #82)

The unused `const _state = await mgr.loadOrCreate()` was eliminated when `loadOrFail()` replaced the double-read pattern. The variable is no longer present.

## Next Deepening Opportunities (Architecture Review Round 4)

| # | Candidate | Strength | Status | Target |
|---|-----------|----------|--------|--------|
| 1 | Extract SkillManager from Agent | Strong | ✅ Done (#82) | `agent.ts` 738→652 |
| 2 | Extract Tool Display from `main.tsx` | Strong | ✅ Done (#82) | `main.tsx` 541→405 |
| 3 | Extract Login Flow Controller from `login.ts` | Worth exploring | Design validated (grilling) | `login.ts` 604→~100 |
| 4 | Extract Command Handlers from `useCommandHandler` | Worth exploring | Not started | 452→~150 |
| 5 | Add `loadOrFail()` to StateManager | Quick win | ✅ Done (#82) | Eliminates double-read |

**Next candidates**: #3 (Login Flow Controller — design validated, ready to implement) → #4 (Command Handlers extraction)

**Note**: The codebase has only 1 `TODO` comment in `src/` (a display label in `useCommandHandler.ts`, not a tech debt marker). No `FIXME`, `HACK`, or `XXX` markers exist.

## Security

### API Key Storage

**Status**: Documented in ADR-014
**Risk**: Low (mitigated)

API keys are stored literally in `~/.tiny-agent/config.yaml` with `0o600` file permissions. The login flow suggests using environment variables (`${VAR_NAME}` syntax) as a more secure alternative. The config loader resolves env-var references at load time.

### Command Injection Prevention

**Files**: `test/security/command-injection.test.ts`, `test/security/bash-env.test.ts`
**Status**: Tested

The bash tool has security tests for command injection prevention and environment variable sanitization. The `src/tools/bash-tool.ts` implementation includes validation and confirmation prompts (ADR-009).

### Path Traversal Prevention

**Files**: `test/security/file-validation.test.ts`
**Status**: Tested

File tools validate paths to prevent directory traversal attacks. The `src/tools/gitignore.ts` module respects `.gitignore` patterns.

### API Key Redaction in Logs

**File**: `src/observability/redact.ts`
**Status**: Tested

API keys are redacted in structured logs and telemetry. The `redactApiKey()` function masks keys as `XXXX...REDACTED`.

## Performance

### Token Counting Overhead

**File**: `src/core/tokens.ts`
**Impact**: Low

Token counting via `tiktoken` is used for context budgeting. The `prepareContext()` function in `src/core/context-budget.ts` counts tokens for system prompt, memory, and conversation messages to fit within the context window. This is done once per `runStream()` call, not per chunk.

### State File I/O Double-Read

**Files**: `src/cli/handlers/plan.ts`, `src/cli/handlers/agent.ts`, `src/ui/hooks/useCommandHandler.ts`
**Impact**: Negligible

CLI handlers read the state file twice: once for the existence check (`readStateFile()`) and once via `StateManager.loadOrCreate()` (which calls `readStateFile()` internally). This is a trade-off for preserving error messages. The state file is small JSON (~1-10 KB), so the overhead is negligible.

### Provider Cache Eviction

**File**: `src/core/provider-cache.ts`
**Impact**: Low

The `ProviderCache` has a max size with LRU eviction (default configurable). Cache hits avoid re-creating LLM clients for the same provider. The `_evictOldest()` method removes the least recently used client when the cache is full.

## Fragile Areas

### Plan Grammar Parser

**File**: `src/agents/plan-grammar.ts` (437 lines)
**Risk**: Medium

The plan grammar parser uses regex-based parsing to extract phases and steps from markdown plan text. It supports two shapes (phase-form and flat-form) and has legacy sub-bullet handling in `buildFlatFormSteps()`. Changes to the plan format require updating both the parser and the `planToBuildSteps()` converter in `build-agent.ts`.

### Ink CLI Rendering

**Files**: `src/ui/` (all components)
**Risk**: Low

The UI uses Ink (React for terminal). Components are tested via `test/cli/main.test.tsx` but Ink rendering is inherently terminal-dependent. The `ThinkingTagFilter` class in `main.tsx` filters `<thinking>` tags from streaming content and has edge cases with partial tag boundaries.

### Embedded Skills Generation

**File**: `src/skills/embedded-content.ts` (generated)
**Risk**: Low

This file is generated at build time by `scripts/generate-embedded-skills.ts` and excluded from linting. Changes to skill content require regenerating this file via `bun run generate:skills`.

### Model Registry Provider Detection

**File**: `src/providers/model-registry.ts`
**Risk**: Low

The `detectProvider()` function maps model string prefixes to provider types. Adding a new provider requires updating the registry patterns. The ClinePass provider (ADR-013) uses live model lookup from `baseUrl` as an alternative to static registry patterns.

## Missing Features / Gaps

### No Coverage Thresholds

The project has 1,288 tests across 80 files but no configured coverage thresholds. Coverage depends on the test-per-module pattern rather than measured line/branch coverage.

### No E2E Browser Testing

The CLI is terminal-based (Ink), so there are no browser tests. The `test/e2e/agent-loop.test.ts` file tests the agent loop end-to-end with a mock LLM client.

### `generateBuildActionsFromPlan` Uses LLM for JSON Parsing

**File**: `src/agents/build-agent.ts` (function `generateBuildActionsFromPlan`)
**Risk**: Low

This function asks the LLM to generate build actions as JSON, then parses the response with a regex match (`content.match(/\[[\s\S]*\]/)`) and `JSON.parse()`. If the LLM returns malformed JSON, the function silently returns an empty array. This is a known limitation of LLM-based code generation.
