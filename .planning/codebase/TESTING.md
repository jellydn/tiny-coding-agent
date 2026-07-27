# Testing

## Framework

**bun:test** (Bun's built-in test runner — Jest-compatible API).

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "bun:test";
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

**65 test files** mirroring `src/`. Rule of thumb: every `src/foo/bar.ts` has a matching `test/foo/bar.test.ts`.

### Distribution by Directory

| Directory | Test Files |
|---|---|
| `test/tools/` | 9 |
| `test/observability/` | 8 |
| `test/core/` | 8 |
| `test/agents/` | 6 |
| `test/` (top-level) | 5 |
| `test/skills/` | 4 |
| `test/security/` | 4 |
| `test/providers/` | 4 |
| `test/cli/handlers/` | 4 |
| `test/cli/` | 4 |
| `test/utils/` | 2 |
| `test/mcp/` | 2 |
| `test/config/` | 2 |
| `test/ui/` | 1 |
| `test/performance/` | 1 |
| `test/e2e/` | 1 |

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

The project avoids `jest.mock`; instead, **dependency injection is preferred**:
- `ToolRegistry` is injectable — tests pass a registry pre-loaded with stubs.
- Provider factory accepts a `providers` map — tests inject a stub provider.
- `StepExecutor` accepts `promptFn` in `StepExecutorOptions` — tests pass a `vi.fn()` mock.
- `TurnExecutor` is tested with a mock LLM client + mock tool registry, without the full Agent setup.

When mocking is unavoidable, define a local stub at the top of the test file:

```ts
// Command-aware bash mock: "fail" → failure, "flaky" → transient, else → success
const bashTool = {
  name: "bash",
  description: "Run a bash command",
  parameters: { type: "object" as const, properties: {}, required: [] },
  execute: async (args: Record<string, unknown>) => {
    const command = String(args?.command ?? "");
    if (command === "fail") return { success: false, error: "Something went wrong" };
    return { success: true, output: "Command executed" };
  },
};
```

### Readline Mocking

`prompt.ts` functions are tested by mocking `readline.createInterface`:

```ts
const createInterfaceSpy = vi.spyOn(readline, "createInterface").mockImplementation(
  () => ({
    question: (_q: string, cb: (answer: string) => void) => {
      queueMicrotask(() => cb("  hello world  "));
    },
    close: () => {},
  }) as unknown as readline.Interface
);
```

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

## What to Test

| Layer | What | Key Test Files |
|---|---|---|
| `src/tools/registry.ts` | register / execute / executeBatch / dangerous routing | `test/tools/registry.test.ts` |
| `src/tools/file-tools.ts` | sensitive-file detection, .gitignore respect, error mapping | `test/tools/file-tools.test.ts` |
| `src/tools/bash-tool.ts` | destructive-command classifier, exit codes, env stripping | `test/tools/bash-tool.test.ts` |
| `src/agents/plan-grammar.ts` | serialize/parse round-trip, validate edge cases | `test/agents/plan-grammar.test.ts` |
| `src/agents/build-agent.ts` | plan → step conversion, dry-run | `test/agents/build-agent.test.ts` |
| `src/agents/step-executor.ts` | retry/skip/abort, change tracking, mapBuildAction | `test/agents/step-executor.test.ts` |
| `src/agents/plan-agent.ts` | exploration hooks, state writes | `test/agents/plan-agent.test.ts` |
| `src/core/agent.ts` | agent loop, streaming, error recovery | `test/core/agent.test.ts` |
| `src/core/turn-executor.ts` | tool batch execution, loop detection, not-found/declined | `test/core/turn-executor.test.ts` |
| `src/cli/handlers/login.ts` | login/logout flows, provider status, pure functions | `test/cli/handlers/login.test.ts` |
| `src/config/config-io.ts` | read/write YAML/JSON, 0o600 permissions, containsLiteralApiKey | `test/config/config-io.test.ts` |
| `src/cli/prompt.ts` | prompt, promptHidden (non-TTY), promptChoice null handling | `test/cli/prompt.test.ts` |
| `src/providers/*` | message-format conversion, streaming token events | `test/providers/*` |
| `src/observability/*` | redaction, token counting, cost math | `test/observability/*` |
| `src/security/*` | command injection, path traversal, env isolation | `test/security/*` |

## Performance & E2E

- `test/performance/benchmarks.test.ts` — measures hot-path latency (tokens, glob, grep, fs).
- `test/e2e/agent-loop.test.ts` — full agent loop with stubbed providers; runs single-turn, multi-turn, file ops, bash ops, memory, persistence, iteration limits, graceful shutdown.

## Running

```bash
bun test                          # everything (1066 tests, 0 failures)
bun test test/agents              # one directory
bun test memory                   # pattern match
bun test --watch                  # watch mode
bun test --coverage               # with coverage
```

## CI

`.github/workflows/ci.yml` runs `bun test` + `bun run check` (lint + typecheck) on every PR.
