# Concerns

Real signals from `rg TODO/FIXME/HACK`, file-size outliers, and observed issues during recent merges.

## Tech Debt

### Case-insensitive-filesystem `Justfile` / `justfile` collision
- **What**: `git ls-files` shows BOTH `Justfile` (uppercase, blob `5afb0dd`) and `justfile` (lowercase, blob `504ff73`) tracked as separate paths in the tree.
- **Why it's a problem**: On case-insensitive macOS APFS (the developer's working env), they collapse to one disk file, so `git status` is permanently chatty and `rm`/`git checkout` interactions are confusing. Linux/Windows CI is unaffected, which is why it hasn't broken CI.
- **Fix**: A single chore commit on the branch to remove the duplicate path (`git rm justfile` + commit). Safe to do as a follow-up; not blocking PRs.

### `_stepError` write-only assignments
- **Where**: `src/agents/build-agent.ts` — `let _stepError: string | undefined; ... _stepError = executionResult.error; ... _stepError = retryResult.error;` — assigned but never read.
- **Why**: Leftover from earlier debugging; prefix-underscore says "intentionally unused".
- **Fix**: Either remove the variable entirely, or wire it into `state.errors` (it currently duplicates what `handleExecutionError` already writes). Low priority — TypeScript strict mode tolerates this.

### Lint info: `continue` in `mode === "none"` branch
- **Where**: `src/agents/plan-grammar.ts` around line 284 — biome flags a redundant `continue` at the end of the `for` loop iteration.
- **Why**: Either the lint rule is over-zealous (the explicit `continue` is documentation) or the loop body genuinely has nothing to do when `mode === "none"`. Worth a quick look — likely delete the line.

### `parsePlanToSteps` more permissive than main's prior regex
- **What**: After the recent merge of PR #56, build-agent uses PR's `PlanGrammar.parse` for plan parsing, which accepts `## Phase 1` (no title required) where main's old regex required a colon + description.
- **Risk**: If any persisted plan in the wild relies on main's strict title-required parsing, it now silently produces empty-title phases. Test coverage includes the new permissive form but not the regression case.
- **Fix**: Add a regression test that asserts empty-title phase detection is reported in `validate()` errors.

## Performance

### Largest files (lines of code, real counts from `find src -name '*.ts' -exec wc -l`)
```
src/core/agent.ts                1166   ← monolithic, top candidate for splitting
src/agents/build-agent.ts         586
src/agents/explore-agent.ts       551
src/core/memory.ts                514
src/tools/file-tools.ts           449
src/agents/plan-grammar.ts        408
src/providers/anthropic.ts        370
src/tools/search-tools.ts         354
src/ui/hooks/useCommandHandler.ts 334
src/providers/ollama.ts           324
```
- **src/core/agent.ts** at 1166 lines is the largest file in the repo by a wide margin and the clearest refactor target — likely extract: conversation-state machine, tool-dispatch loop, streaming token handler, error-recovery policy.
- **build-agent.ts** at 586 lines is borderline monolithic. Refactor opportunity: extract `executeBuildAction` (now removed) back into `src/tools/` if PR #52's registry-based path stabilizes further.

### Streaming provider perf
- Provider streaming tests exist but no benchmark on first-token latency. `test/performance/benchmarks.test.ts` covers token counting and grep/glob but not streaming TTFT.

## Security

- **Secret redaction** in `src/observability/redact.ts` covers `.env`, `.aws/`, `.ssh/`, etc. — good coverage but only applies to log lines, not to tool output sent back to the model. If a tool reads `~/.aws/credentials` and the dangerous-tool check fails, the result is still in `tool.execute()` return — review path-validation in `src/tools/file-tools.ts:validatePath`.
- **Sensitive bash classifier** (`src/tools/bash-tool.ts`) is a regex/allowlist — adequate for common patterns but won't catch every destructive command. Default-deny would be safer; consider flipping for `rm -rf /` family in particular.
- **MCP servers** run with the same fs/network privileges as the agent. No sandboxing layer beyond what Bun provides. Document this in user-facing docs.

## Fragile Areas

- **PlanGrammar round-trip** — `serialize(plan) → parse(text) → deep-equal(original)` is the load-bearing invariant. Test suite covers it, but any new field added to `Plan`/`Phase`/`Step` MUST update the `serialize` template AND a test.
- **`ToolRegistry.executeBatch`** confirmation logic has multiple branches (`false`, `{type: "partial"}`, all-approved) — easy to break. The CLI's confirmation handler in `src/tools/confirmation.ts` is the counterpart and must stay in sync.
- **Provider streaming** events are emitted into `src/observability/` — if a provider fails to flush on error, traces go incomplete. `test/observability/agent-observability.test.ts` exists but coverage of partial-failure scenarios is thin.

## Observability

- **Langfuse** is opt-in via env vars. No local trace viewer — users without a Langfuse account have no way to inspect what the agent did beyond stdout. A built-in HTML trace dump would help debugging.
- **Token cost** uses `src/observability/model-pricing.json` — bundled snapshot. Drift from real provider pricing is possible; consider fetching on startup like `models-dev.ts` does for capabilities.

## Test Coverage Gaps

- No test for `src/tools/plugin-loader.ts` (plugin discovery edge cases — symlinks, missing files, duplicates).
- No test for `src/cli/handlers/upgrade.ts` (binary swap, partial-download rollback).
- No e2e covering an MCP server lifecycle (connect, tool call, disconnect, reconnect).
- No concurrency test for `src/core/memory.ts` writes from concurrent agents (the state file is shared).

## Build & Release

- **Embedded skills** generated at build time — if a contributor forgets to run `bun run generate:skills`, the built binary ships stale content. CI runs it (`.github/workflows/ci.yml`), but a pre-commit hook would catch it locally.
- **Version constant** — `src/utils/version-constant.ts` is generated; commit-time check exists in CI but a developer who bypasses CI gets a stale `0.0.0` build.

## Documentation

- ADRs in `docs/adr/` are good (001-011), but `docs/README.md` is missing — entry point for new contributors is implicit via AGENTS.md/CLAUDE.md.
- No architecture diagram in docs (this codemap fills that gap going forward).

## Quick Wins (sorted by ROI)

1. Delete the redundant `continue` in `src/agents/plan-grammar.ts` (1 line, removes a lint warning).
2. Remove the lowercase `justfile` tracking on this branch (chore commit, clears up `git status`).
3. Add a regression test for empty-title phase detection in `plan-grammar.test.ts`.
4. Wire `_stepError` into `state.errors` properly or delete it.
5. Add a `--dump-trace <path>` flag that writes the current session's trace to a local HTML file (offline trace viewer).
