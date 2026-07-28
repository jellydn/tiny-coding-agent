# Technical Concerns

## Tech Debt

### 1. `agent.ts` Still 738 Lines After Decomposition

**File**: `src/core/agent.ts` (738 lines)
**Severity**: Medium
**Status**: Improving (was 1,173 lines before ADR-016 extraction)

After extracting 10 modules (TurnExecutor, AgentObservability, DebugLogger, ProviderCache, context-budget, agent-utils, etc.), `agent.ts` dropped from 1,173 → 738 lines. However, it still owns 4 skill-related private fields + 8 skill methods (`_initializeSkills`, `loadSkill`, `_setSkillRestriction`, `_clearSkillRestriction`, `getSkillRegistry`, `waitForSkills`, `_getToolDefinitions` filtering). The skill management concern could be extracted into a `SkillManager` class to continue the decomposition pattern.

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

### 4. `main.tsx` Mixes CLI Entry Point + Display Logic

**File**: `src/cli/main.tsx` (541 lines)
**Severity**: Low
**Status**: Partially refactored (command-dispatch extracted)

`main.tsx` still mixes 3 concerns: (1) CLI entry-point orchestration (`main()`, arg parsing), (2) the `handleRun` streaming loop, and (3) tool display formatting (`ThinkingTagFilter`, `formatArgs`, `formatOutputPreview`, `displayToolExecutionPlain/Ink`, `outputJson`). The display utilities are pure functions that could be extracted into `src/cli/tool-display.ts`.

### 5. State File I/O Still Duplicated in CLI Handlers

**Files**: `src/cli/handlers/plan.ts`, `src/cli/handlers/agent.ts`, `src/ui/hooks/useCommandHandler.ts`
**Severity**: Low
**Status**: Improving (StateManager extracted but not yet merged)

The `StateManager` class (`src/agents/state-manager.ts`) was created to consolidate state file I/O, but CLI handlers still do a `readStateFile()` existence check before creating a `StateManager` — a double-read trade-off to preserve original error messages for tests. This could be resolved by adding a `loadOrFail()` method to StateManager.

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
