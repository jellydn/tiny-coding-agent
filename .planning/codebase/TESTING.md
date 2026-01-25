# Testing Patterns

**Analysis Date:** 2026-01-25

## Test Framework

**Runner:**

- `bun:test` - Built-in test runner in Bun
- Version: Bundled with Bun runtime

**Assertion Library:**

- `bun:test` built-in assertions
- Matchers: `expect()`, `toBe()`, `toEqual()`, `toContain()`, `toBeDefined()`, etc.

**Run Commands:**

```bash
bun test                   # Run all tests
bun test <file>            # Run single test file
bun test <pattern>         # Run tests matching pattern
bun test:watch             # Watch mode for TDD
```

## Test File Organization

**Location:**

- Separate `test/` directory at project root
- Parallel structure to `src/` directory

**Naming:**

- `*.test.ts` - All test files
- Example: `agent.test.ts`, `file-tools.test.ts`, `memory.test.ts`

**Structure:**

```
test/
├── core/
│   ├── agent.test.ts
│   ├── conversation.test.ts
│   └── memory.test.ts
├── tools/
│   ├── bash-tool.test.ts
│   ├── file-tools.test.ts
│   ├── gitignore.test.ts
│   └── search-tools.test.ts
├── security/
│   ├── command-injection.test.ts
│   └── file-validation.test.ts
└── providers/
    └── anthropic-provider.test.ts
```

## Test Structure

**Suite Organization:**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";

describe("Component/Module", () => {
  describe("methodName()", () => {
    it("should do expected behavior", () => {
      // Test implementation
    });

    it("should handle edge case", () => {
      // Edge case test
    });
  });
});
```

**Patterns:**

**Setup with beforeEach:**

```typescript
const tempFile = "/tmp/test-file.json";

beforeEach(() => {
  try {
    unlinkSync(tempFile);
  } catch {
    // Ignore if file doesn't exist
  }
});
```

**Teardown with afterEach:**

```typescript
afterEach(() => {
  try {
    unlinkSync(tempFile);
  } catch {
    // Ignore if file doesn't exist
  }
});
```

**Nested Describe Blocks:**

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
      store.add("TypeScript is great");
      const results = store.findRelevant("TypeScript", 2);
      expect(results.length).toBe(2);
    });
  });
});
```

## Mocking

**Framework:**

- Manual mocks (no external mocking library)
- Class-based mock implementations

**MockLLMClient Pattern:**

For testing components that depend on `LLMClient`:

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

**Mock Tool Registrations:**

```typescript
const registry = new ToolRegistry();
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

**Stream Mocking with State:**

```typescript
class ToolCallMockLLMClient implements LLMClient {
  private callCount = 0;

  async *stream(_options: ChatOptions): AsyncGenerator<StreamChunk, void, unknown> {
    this.callCount++;

    if (this.callCount === 1) {
      // First call: try to use a non-existent tool
      yield {
        content: "",
        toolCalls: [
          {
            id: "call_123",
            name: "nonexistent.tool",
            arguments: { param: "value" },
          },
        ],
        done: false,
      };
      yield { done: true };
    } else {
      // Second call: provide final answer
      yield { content: "Final answer", done: false };
      yield { done: true };
    }
  }
}
```

**Private Member Access in Tests:**

```typescript
// Use type assertion to access private members for testing
const agentPrivate = agent as unknown as {
  _activeSkillAllowedTools: string[] | undefined;
  _getToolDefinitions(): ToolDefinition[];
};
expect(agentPrivate._activeSkillAllowedTools).toEqual(["read"]);
```

## Fixtures and Factories

**Test Data Factories:**

```typescript
function createMessages(...contents: string[]): Message[] {
  return contents.map((content, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content,
  }));
}
```

**Location:**

- Inline in test files for test-specific helpers
- Exported from source modules for shared utilities

**Temporary Files:**

```typescript
const tempFile = "/tmp/test-memory-store.json";
const tempConversationFile = "/tmp/test-agent-conversation.json";
```

## Common Patterns

**Async Testing with Generators:**

```typescript
it("should maintain conversation history across multiple turns", async () => {
  const llm = new MockLLMClient();
  const agent = new Agent(llm, registry);

  for await (const _chunk of agent.runStream("Hello", "mock-model")) {
    // Consume stream
  }

  const history = agent._conversationManager.getHistory();
  expect(history.length).toBeGreaterThan(0);
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

**Edge Case Testing:**

```typescript
it("should handle empty input", () => {
  const store = new MemoryStore({ filePath: tempFile, maxMemories: 10 });
  store.add("");
  expect(store.count()).toBe(1);
});
```

**Private Member Testing:**

```typescript
it("should update in-memory history when called", () => {
  const agent = new Agent(llm, registry);
  const messages = createMessages("User message", "Assistant response");

  agent._updateConversationHistory(messages);

  expect(
    (
      agent as unknown as { _conversationManager: ConversationManager }
    )._conversationManager.getHistory(),
  ).toEqual(messages);
});
```

## Test Categories

**Unit Tests:**

- Test individual functions and classes in isolation
- Mock all external dependencies
- Example: `memory.test.ts`, `file-tools.test.ts`

**Integration Tests:**

- Test multiple components working together
- Use real file system operations with temp files
- Example: `agent.test.ts`, `bash-tool.test.ts`

**Security Tests:**

- Test security boundaries and validation
- Example: `command-injection.test.ts`, `file-validation.test.ts`

## Test Utilities

**File System Helpers:**

```typescript
import { unlinkSync, writeFileSync } from "node:fs";

beforeEach(() => {
  try {
    unlinkSync(tempFile);
  } catch {
    // Ignore if file doesn't exist
  }
});
```

**Assertion Patterns:**

- `toBe()` - Strict equality
- `toEqual()` - Deep equality (objects, arrays)
- `toContain()` - Array/string contains value
- `toBeDefined()` - Value is not undefined
- `toBeGreaterThan()` - Numeric comparison
- `toBeTruthy()` - Truthy check
- `toBeInstanceOf()` - Class instance check

## Coverage

**Requirements:**

- Not explicitly enforced in configuration
- Manual coverage awareness during development

**View Coverage:**

```bash
bun test --coverage  # Not currently configured
```

## Best Practices Observed

1. **Test file location**: Parallel structure to `src/` in `test/` directory
2. **Cleanup**: Always clean up temp files in `beforeEach`/`afterEach`
3. **Descriptive names**: Test names describe behavior, not implementation
4. **Isolated tests**: Each test should be independent
5. **Mock patterns**: Manual mocks for clean, type-safe testing
6. **Edge cases**: Test boundary conditions and error paths
7. **Private access**: Use type assertions for testing private members when needed

---

_Testing analysis: 2026-01-25_
