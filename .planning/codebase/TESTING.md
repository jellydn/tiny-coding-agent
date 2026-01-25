# Testing Patterns

**Analysis Date:** 2026-01-25

## Test Framework

**Runner:**

- bun:test (built into Bun runtime)
- Config: No separate config file, uses defaults
- Version: Bundled with Bun

**Assertion Library:**

- bun:test assertions (`expect`, `toBe`, `toEqual`, `toBeDefined`, etc.)

**Run Commands:**

```bash
bun test                    # Run all tests
bun test <file>             # Run single test file
bun test <pattern>          # Run tests matching pattern
bun test:watch              # Watch mode for TDD
```

## Test File Organization

**Location:**

- `test/` directory at project root (parallel to `src/`)
- Mirror `src/` directory structure:
  - `test/core/` for core module tests
  - `test/tools/` for tool tests
  - `test/providers/` for provider tests
  - `test/skills/` for skills tests
  - `test/cli/` for CLI tests
  - `test/ui/` for UI tests

**Naming:**

- `{module}.test.ts` pattern: `memory.test.ts`, `agent.test.ts`, `file-tools.test.ts`

**Structure:**

```
test/
  core/
    agent.test.ts
    memory.test.ts
    conversation.test.ts
  tools/
    file-tools.test.ts
    bash-tool.test.ts
  providers/
    anthropic.test.ts
    ollama.test.ts
  ...
```

## Test Structure

**Suite Organization:**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";

describe("ModuleName", () => {
  describe("methodName()", () => {
    it("should do something", () => {
      // Test implementation
    });

    it("should handle edge case", () => {
      // Test implementation
    });
  });

  describe("anotherMethod()", () => {
    it("should return expected value", () => {
      // Test implementation
    });
  });
});
```

**Patterns:**

- Nested `describe` blocks for methods/features
- `beforeEach` for setup
- `afterEach` for cleanup
- One expectation per test for clarity (not required but preferred)

**Example from `test/core/memory.test.ts`:**

```typescript
describe("MemoryStore", () => {
  describe("_evictIfNeeded()", () => {
    it("should evict oldest memories when over max limit", () => {
      const store = new MemoryStore({ filePath: tempFile, maxMemories: 3 });
      store.add("memory 1");
      store.add("memory 2");
      store.add("memory 3");
      store.add("memory 4");
      expect(store.count()).toBe(3);
    });
  });

  describe("findRelevant()", () => {
    it("should return memories that match the query", () => {
      const store = new MemoryStore({ filePath: tempFile, maxMemories: 10 });
      store.add("TypeScript is great", "project");
      const results = store.findRelevant("TypeScript", 2);
      expect(results.length).toBe(2);
    });
  });
});
```

## Mocking

**Framework:** Bun test utilities + manual mock classes

**Mock Classes:**
Implement interfaces or extend base classes:

```typescript
class MockLLMClient implements LLMClient {
  async chat(_options: ChatOptions): Promise<ChatResponse> {
    return {
      content: "Mock response",
      finishReason: "stop",
    };
  }

  async *stream(_options: ChatOptions): AsyncGenerator<StreamChunk, void, unknown> {
    yield { content: "Mock response", done: false };
    yield { done: true };
  }

  async getCapabilities(_model: string) {
    return {
      maxTokens: 100000,
      supportsStreaming: true,
      supportsTools: true,
      modelName: "mock-model",
      supportsSystemPrompt: true,
      supportsToolStreaming: false,
      supportsThinking: false,
    };
  }
}
```

**Tool Mocks:**
Register mock tools in `ToolRegistry` for testing:

```typescript
registry.register({
  name: "read",
  description: "Read a file",
  parameters: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
  execute: async () => ({ success: true, output: "file content" }),
});
```

**Private Member Access:**
Use type assertion to access private members for testing:

```typescript
const agentPrivate = agent as unknown as {
  _activeSkillAllowedTools: string[] | undefined;
  _conversationManager: ConversationManager;
  _getToolDefinitions(): ReturnType<
    typeof import("./agent.ts").Agent.prototype._getToolDefinitions
  >;
};
```

## Fixtures and Factories

**Test Data:**

- Manual creation in tests
- Helper functions for common setups:

```typescript
function createMessages(...contents: string[]): Message[] {
  return contents.map((content, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content,
  }));
}
```

**Temporary Files:**

- Use `/tmp/` for temp file tests
- Clean up in `beforeEach` and `afterEach`:

```typescript
const tempFile = "/tmp/test-memory-store.json";

beforeEach(() => {
  try {
    unlinkSync(tempFile);
  } catch {
    // Ignore if file doesn't exist
  }
});

afterEach(() => {
  try {
    unlinkSync(tempFile);
  } catch {
    // Ignore if file doesn't exist
  }
});
```

## Coverage

**Requirements:** None explicitly enforced

**View Coverage:**

```bash
bun test --coverage  # Note: Check if supported by bun version
```

**Note:** No coverage threshold is currently enforced in the project.

## Test Types

**Unit Tests:**

- Test individual classes and functions in isolation
- Mock external dependencies (LLM clients, file system)
- Example: `test/core/memory.test.ts` tests `MemoryStore` class

**Integration Tests:**

- Test tool registry and tool execution
- Example: `test/tools/file-tools.test.ts` tests file tool validation

**No E2E Tests:**

- Project does not use Playwright, Cypress, or other E2E frameworks
- Agent behavior tested via unit/mock tests

## Common Patterns

**Async Testing:**

```typescript
it("should load conversation from file when conversationFile is set", async () => {
  writeFileSync(tempConversationFile, JSON.stringify({ messages: existingConversation }, null, 2));
  const llm = new MockLLMClient();
  const registry = new ToolRegistry();
  const agent = new Agent(llm, registry, { conversationFile: tempConversationFile });

  for await (const _chunk of agent.runStream("New message", "mock-model")) {
  }

  expect(history[0]).toEqual({ role: "user", content: "Previous user message" });
});
```

**Error Testing:**

```typescript
it("should return file not found error for ENOENT", () => {
  const err = { code: "ENOENT", message: "enoent" } as NodeJS.ErrnoException;
  const result = handleFileError("/path/to/file.txt", err, "Failed to read file");
  expect(result.success).toBe(false);
  expect(result.error).toBe("File not found: /path/to/file.txt");
});
```

**Stream Testing:**

```typescript
async *stream(_options: ChatOptions): AsyncGenerator<StreamChunk, void, unknown> {
  yield { content: "Mock response", done: false };
  yield { done: true };
}
```

## What to Mock

**Mock These:**

- LLM clients (`LLMClient` interface)
- File system operations (via error injection)
- External services (APIs, databases)
- Time-dependent behavior (use controlled mocks)

**Don't Mock:**

- Built-in Node.js modules (test directly)
- Simple utility functions
- Internal class logic (test the behavior, not implementation)

## Key Test Files

| File                               | Purpose                            |
| ---------------------------------- | ---------------------------------- |
| `test/core/memory.test.ts`         | MemoryStore class tests            |
| `test/core/agent.test.ts`          | Agent class with mock LLM          |
| `test/tools/file-tools.test.ts`    | File validation and error handling |
| `test/providers/anthropic.test.ts` | Anthropic provider tests           |
| `test/config/loader.test.ts`       | Config loading tests               |

---

_Testing analysis: 2026-01-25_
