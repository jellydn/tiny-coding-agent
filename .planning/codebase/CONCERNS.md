# Concerns

Real signals from `rg TODO/FIXME/HACK`, file-size outliers, and observed issues during recent merges.

## Tech Debt

### Case-insensitive-filesystem `Justfile` / `justfile` collision
- **What**: `git ls-files` shows BOTH `Justfile` (uppercase) and `justfile` (lowercase) tracked as separate paths in the tree.
- **Why it's a problem**: On case-insensitive macOS APFS, they collapse to one disk file, so `git status` is permanently chatty.
- **Fix**: A single chore commit to remove the duplicate path (`git rm justfile` + commit). Safe to do as a follow-up.

### `_stepError` write-only assignments (resolved)
- **Where**: `src/agents/build-agent.ts` — previously had `let _stepError` assigned but never read.
- **Status**: Likely resolved by the StepExecutor extraction (PR #65). The variable was part of the old inline execution loop that was moved to `step-executor.ts`. Verify it's gone.

### Lint info: `continue` in `plan-grammar.ts`
- **Where**: `src/agents/plan-grammar.ts` around line 284 — biome flags a redundant `continue` at the end of the `for` loop iteration.
- **Fix**: Delete the line. 1-line fix, removes a lint warning.

### `parsePlanToSteps` more permissive than main's prior regex
- **What**: After PR #56, build-agent uses `PlanGrammar.parse` for plan parsing, which accepts `## Phase 1` (no title required) where the old regex required a colon + description.
- **Risk**: Persisted plans relying on strict title-required parsing now silently produce empty-title phases.
- **Fix**: Add a regression test that asserts empty-title phase detection is reported in `validate()` errors.

## Performance

### Largest files (lines of code)
```
src/core/agent.ts                1052  ← still largest, but TurnExecutor extraction reduced it from ~1173
src/cli/main.tsx                  605  ← reduced by createAgent factory extraction
src/cli/handlers/login.ts         590  ← includes both login AND logout handlers
src/agents/explore-agent.ts       551
src/core/memory.ts                514
src/tools/file-tools.ts           449
src/agents/plan-grammar.ts        408
src/providers/anthropic.ts        370
src/tools/search-tools.ts         354
src/ui/hooks/useCommandHandler.ts 334
```

- **`src/core/agent.ts`** at 1052 lines is still the largest file. The TurnExecutor extraction (PR #63) removed ~120 lines of inline tool dispatch logic, and agent-utils.ts extracted `isLooping`/`truncateOutput`. Further refactoring could extract the streaming/observability instrumentation.
- **`src/cli/handlers/login.ts`** at 590 lines houses both login and logout. If logout grows further, consider splitting into `login.ts` + `logout.ts`.

### Streaming provider perf
- Provider streaming tests exist but no benchmark on first-token latency. `test/performance/benchmarks.test.ts` covers token counting and grep/glob but not streaming TTFT.

## Security

- **Config file permissions**: `writeConfigFile()` in `src/config/config-io.ts` now enforces `0o600` via `chmod` after write when `containsLiteralApiKey()` returns true (PR #67 on `fix/design-smells` branch — verify it's merged). Previously, `mode: 0o600` only applied on file creation, leaving existing files world-readable.
- **`promptHidden` Ctrl+C**: Now rejects the promise instead of calling `process.exit(0)` (PR #67). Callers use `try/catch` to handle cancellation. Verify merged.
- **Secret redaction** in `src/observability/redact.ts` covers `.env`, `.aws/`, `.ssh/`, etc. — good coverage but only applies to log lines, not to tool output sent back to the model.
- **Sensitive bash classifier** (`src/tools/bash-tool.ts`) is a regex/allowlist — adequate for common patterns but won't catch every destructive command. Default-deny would be safer.
- **MCP servers** run with the same fs/network privileges as the agent. No sandboxing layer beyond what Bun provides.

## Fragile Areas

- **PlanGrammar round-trip** — `serialize(plan) → parse(text) → deep-equal(original)` is the load-bearing invariant. Any new field added to `Plan`/`Phase`/`Step` MUST update the `serialize` template AND a test.
- **`ToolRegistry.executeBatch`** confirmation logic has multiple branches (`false`, `{type: "partial"}`, all-approved) — easy to break. The CLI's confirmation handler in `src/tools/confirmation.ts` is the counterpart and must stay in sync.
- **Provider streaming** events are emitted into `src/observability/` — if a provider fails to flush on error, traces go incomplete. Coverage of partial-failure scenarios is thin.
- **Circular dependency breaking pattern** — `turn-executor.ts` ↔ `agent-utils.ts` and `step-executor.ts` ↔ `build-agent.ts` rely on `import type` being erased at compile time. If someone accidentally adds a runtime import, the cycle returns. No automated guard exists.

## Observability

- **Langfuse** is opt-in via env vars. No local trace viewer — users without a Langfuse account have no way to inspect what the agent did beyond stdout.
- **Token cost** uses `src/observability/model-pricing.json` — bundled snapshot. Drift from real provider pricing is possible.

## Test Coverage Gaps

- No test for `src/tools/plugin-loader.ts` (plugin discovery edge cases — symlinks, missing files, duplicates).
- No test for `src/cli/handlers/upgrade.ts` (binary swap, partial-download rollback).
- No e2e covering an MCP server lifecycle (connect, tool call, disconnect, reconnect).
- No concurrency test for `src/core/memory.ts` writes from concurrent agents (the state file is shared).
- **`promptHidden` Ctrl+C rejection** — the TTY raw-mode path's `reject(new Error("Interrupted by user (Ctrl+C)"))` is untested. All existing tests use the non-TTY fallback. Adding a test requires mocking `stdin.setRawMode` and simulating a `\u0003` character.

## Build & Release

- **Embedded skills** generated at build time — if a contributor forgets to run `bun run generate:skills`, the built binary ships stale content. CI runs it, but a pre-commit hook would catch it locally.
- **Version constant** — `src/utils/version-constant.ts` is generated; commit-time check exists in CI but a developer who bypasses CI gets a stale `0.0.0` build.

## Documentation

- ADRs in `docs/adr/` are comprehensive (001-014). `docs/README.md` has the full index.
- `README.md` has been updated with login/logout command documentation and ADR list (PR #68).
- No architecture diagram in docs (this codebase map fills that gap).

## Quick Wins (sorted by ROI)

1. Delete the redundant `continue` in `src/agents/plan-grammar.ts` (1 line, removes a lint warning).
2. Remove the lowercase `justfile` tracking (chore commit, clears up `git status`).
3. Add a regression test for empty-title phase detection in `plan-grammar.test.ts`.
4. Verify `_stepError` is gone from `build-agent.ts` after StepExecutor extraction.
5. Add a `--dump-trace <path>` flag that writes the current session's trace to a local HTML file (offline trace viewer).
6. Merge PR #67 (design smell fixes) if not yet merged — addresses `0o600` chmod, `promptChoice` null, `promptHidden` rejection.
