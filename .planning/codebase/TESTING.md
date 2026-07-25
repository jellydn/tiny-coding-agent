# Testing

## Framework

**bun:test** (Bun's built-in test runner — Jest-compatible API).

```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
```

## Test File Layout

```
test/
├── <mirror-of-src-tree>/<file>.test.ts
├── performance/benchmarks.test.ts
├── e2e/agent-loop.test.ts
├── ui/utils.test.ts                    # UI helpers
├── agent.test.ts, memory.test.ts       # top-level integration
└── ...
```

Rule of thumb: every `src/foo/bar.ts` has a matching `test/foo/bar.test.ts`.

## Patterns

### Describe / It / Expect

```ts
describe("ToolRegistry", () => {
  it("registers and retrieves a tool", () => {
    const r = new ToolRegistry();
    r.register(myTool);
    expect(r.get("my-tool")?.name).toBe("my-tool");
  });
});
```

### Setup / Teardown

```ts
const tempFile = "/tmp/test-state.json";

beforeEach(() => { try { unlinkSync(tempFile); } catch {} });
afterEach(() => { try { unlinkSync(tempFile); } catch {} });
```

Always clean up temp files; never let a failing test leak state.

### Async / Await

```ts
it("parses a plan end-to-end", async () => {
  const steps = await parsePlanToSteps(plan);
  expect(steps.length).toBeGreaterThan(0);
});
```

### Mocking

- The project avoids `jest.mock`; instead, dependency injection is preferred.
  - `ToolRegistry` is injectable — tests pass a registry pre-loaded with stubs.
  - Provider factory accepts a `providers` map — tests inject a stub provider.
- When mocking is unavoidable, define a local stub at the top of the test file.

### Table-Driven / Parameterized

```ts
it.each([
  ["## Phase 1: X\n1. Step", 1],
  ["1. A\n2. B", 2],
])("parses %s as %i phases", (input, expected) => {
  expect(parsePlanGrammar(input).phases.length).toBe(expected);
});
```

## Behavioral Focus

Tests exercise behavior, not implementation:

```ts
// ✅ good: tests observable contract
expect(registry.execute("read_file", { path }).success).toBe(true);

// ❌ bad: tests internal cache
expect((registry as any)._cache.has("read_file")).toBe(true);
```

## Coverage

Not configured by default. Run with:

```bash
bun test --coverage
```

to see Bun's built-in coverage report. Aim for: every public function in `src/agents/`, `src/tools/`, `src/providers/`, `src/cli/handlers/` has at least one test.

## What to Test

| Layer | What |
|---|---|
| `src/tools/registry.ts` | register / execute / executeBatch / dangerous routing |
| `src/tools/file-tools.ts` | sensitive-file detection, .gitignore respect, error mapping |
| `src/tools/bash-tool.ts` | destructive-command classifier, exit codes, env stripping |
| `src/agents/plan-grammar.ts` | serialize/parse round-trip, validate edge cases |
| `src/agents/build-agent.ts` | plan → step conversion, dry-run |
| `src/agents/plan-agent.ts` | exploration hooks, state writes |
| `src/cli/handlers/*` | exit codes, stdout/stderr shape, error messages |
| `src/providers/*` | message-format conversion, streaming token events |
| `src/observability/*` | redaction, token counting, cost math |
| `src/security/*` | command injection, path traversal, env isolation |

## Performance & E2E

- `test/performance/benchmarks.test.ts` — measures hot-path latency (tokens, glob, grep, fs).
- `test/e2e/agent-loop.test.ts` — full agent loop with stubbed providers; runs single-turn, multi-turn, file ops, bash ops, memory, persistence, iteration limits, graceful shutdown.

## Running

```bash
bun test                          # everything
bun test test/agents              # one directory
bun test memory                   # pattern match
bun test --watch                  # watch mode
bun test --coverage               # with coverage
```

## CI

`.github/workflows/ci.yml` runs `bun run pre` on every PR, which runs `bun test` then `bun run check` (lint + typecheck).
