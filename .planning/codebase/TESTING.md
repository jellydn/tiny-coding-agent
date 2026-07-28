# Testing

## Framework

| Property | Value |
|----------|-------|
| Framework | `bun:test` (Bun's built-in test runner) |
| Assertion library | `bun:test` (`expect`, `toEqual`, `toBe`, etc.) |
| Test runner | `bun test` |
| Watch mode | `bun test:watch` (`bun test --watch`) |
| Coverage | Not configured (relies on test count + behavior testing) |

## Test Statistics

| Metric | Value |
|--------|-------|
| Test files | 80 |
| Total tests | 1,288 |
| Assertions | 2,795 `expect()` calls |
| Pass rate | 100% (0 failures) |
| Test lines | ~17,139 |
| Execution time | ~5 seconds |

## Test Structure

Tests mirror the `src/` directory structure:

```
test/
├── agents/              # Agent tests (8 files)
│   ├── build-agent.test.ts
│   ├── codebase-explorer.test.ts
│   ├── explore-agent.test.ts
│   ├── plan-agent.test.ts
│   ├── plan-grammar.test.ts
│   ├── state.test.ts
│   └── step-executor.test.ts
├── cli/                 # CLI tests (10 files)
│   ├── handlers/        # One test file per CLI handler
│   ├── chat-commands.test.ts
│   ├── command-dispatch.test.ts
│   ├── integration.test.ts
│   └── main.test.tsx
├── config/              # Config tests (2 files)
├── core/                # Core module tests (15 files)
│   ├── agent.test.ts
│   ├── agent-fallback.test.ts
│   ├── agent-observability.test.ts
│   ├── agent-utils-stream.test.ts
│   ├── context-budget.test.ts
│   ├── debug-logger.test.ts
│   ├── provider-cache.test.ts
│   ├── turn-executor.test.ts
│   └── ...
├── e2e/                 # End-to-end tests (1 file)
│   └── agent-loop.test.ts
├── hooks/               # Hooks tests (4 files)
├── mcp/                 # MCP tests (2 files)
├── observability/       # Observability tests (8 files)
├── providers/           # Provider tests (5 files)
├── security/            # Security tests (4 files)
│   ├── bash-env.test.ts
│   ├── command-injection.test.ts
│   ├── file-validation.test.ts
│   └── security-suite.test.ts
├── skills/              # Skills tests (4 files)
├── tools/               # Tool tests (8 files)
├── ui/                  # UI tests (3 files)
└── utils/               # Utility tests (2 files)
```

## Test Patterns

### Basic Test Structure

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";

describe("MemoryStore", () => {
  const tempFile = "/tmp/test-memory.json";

  beforeEach(() => {
    try {
      unlinkSync(tempFile);
    } catch {
      /* ignore */
    }
  });

  it("should evict oldest memories when over max limit", () => {
    const store = new MemoryStore({ filePath: tempFile, maxMemories: 3 });
    store.add("1");
    store.add("2");
    store.add("3");
    store.add("4");
    expect(store.count()).toBe(3);
  });
});
```

### Cleanup Pattern

Tests that create files must clean up in `beforeEach`/`afterEach`:

```typescript
beforeEach(() => {
  try { unlinkSync(tempFile); } catch { /* ignore */ }
});

afterEach(() => {
  try { unlinkSync(tempFile); } catch { /* ignore */ }
});
```

### Mocking Patterns

#### Mocking LLM Clients

```typescript
const mockClient: LLMClient = {
  chat: async () => ({ content: "mock response", usage: undefined }),
  chatStream: async function* () { yield "mock"; },
};
```

#### Mocking Tool Registry

```typescript
const registry = new ToolRegistry();
registry.register({
  name: "test_tool",
  description: "Test tool",
  parameters: { type: "object", properties: {} },
  execute: async () => ({ success: true, output: "ok" }),
});
```

#### Mocking stdin (readline prompts)

```typescript
// Mock prompt to return a specific value
const mockPrompt = async () => "y";
const executor = new StepExecutor(registry, { promptFn: mockPrompt });
```

#### Mocking process.exit

Tests that exercise CLI handlers mock `process.exit` to prevent the test runner from exiting:

```typescript
const exitSpy = mock((code?: number) => { throw new Error(`exit:${code}`); });
mock.module("node:process", () => ({ ...process, exit: exitSpy }));
```

### Test Categories

#### Unit Tests

Test individual modules in isolation:
- `test/core/turn-executor.test.ts` — TurnExecutor with mock registry
- `test/core/provider-cache.test.ts` — ProviderCache with mock clients
- `test/core/debug-logger.test.ts` — DebugLogger no-op behavior
- `test/agents/step-executor.test.ts` — StepExecutor with mock prompt

#### Integration Tests

Test multiple modules working together:
- `test/cli/integration.test.ts` — CLI arg parsing + dispatch
- `test/e2e/agent-loop.test.ts` — Full agent loop with mock LLM

#### Security Tests

Dedicated security test suite in `test/security/`:
- `command-injection.test.ts` — bash tool injection prevention
- `bash-env.test.ts` — environment variable sanitization
- `file-validation.test.ts` — path traversal prevention
- `security-suite.test.ts` — combined security validation

## Running Tests

```bash
bun test                         # All tests
bun test <file>                  # Single file (e.g., "bun test tools/file.test.ts")
bun test <pattern>               # Pattern match (e.g., "bun test memory")
bun test:watch                   # Watch mode for TDD
```

## CI Testing

Tests run on CI in `.github/workflows/ci.yml`:
- **ubuntu-latest**: Full test suite
- **macos-latest**: Full test suite
- Bun latest version
- Dependency caching via `actions/cache`

## Testing Philosophy

- **Test behavior, not implementation details** — tests should give confidence that the code works
- **Clean up resources** — `beforeEach`/`afterEach` for temp files
- **Mock at the seam** — mock `LLMClient`, `ToolRegistry`, `prompt` — not internals
- **Structured results** — tests use `{ success: boolean, error?: string }` pattern matching the codebase convention
- **No coverage thresholds** — relies on 1,288 tests across 80 files covering all modules
