# Testing Patterns

**Analysis Date:** 2026-01-25

## Test Framework

**Runner:**
- bun:test (built into Bun runtime)
- Version: latest (via `@types/bun` dev dependency)
- Config: No separate config file; uses bun:test conventions

**Assertion Library:**
- Built-in `expect` from bun:test
- Matchers: `toBe()`, `toEqual()`, `toBeDefined()`, `toBeUndefined()`, `toBeGreaterThan()`, `toContain()`, `toThrow()`, etc.

**Run Commands:**
```bash
bun test                    # Run all tests
bun test <file>             # Run single test file (e.g., "bun test tools/file.test.ts")
bun test <pattern>          # Run tests matching pattern (e.g., "bun test memory")
bun test:watch              # Watch mode for TDD
```

## Test File Organization

**Location:**
- Separate `test/` directory at project root
- Mirrors source structure: `test/core/`, `test/tools/`, `test/providers/`, etc.

**Naming:**
- `*.test.ts` suffix for all test files
- Examples: `agent.test.ts`, `memory.test.ts`, `file-tools.test.ts`

**Structure:**
```
test/
├── agent.test.ts           # Core agent tests
├── memory.test.ts          # Memory store tests
├── core/
│   ├── agent.test.ts
│   ├── conversation.test.ts
│   └── memory.test.ts
├── tools/
│   ├── file-tools.test.ts
│   ├── bash-tool.test.ts
│   ├── registry.test.ts
│   └── skill-tool.test.ts
├── providers/
│   ├── anthropic.test.ts
│   └── ollama.test.ts
├── security/
│   ├── file-validation.test.ts
│   └── command-injection.test.ts
└── e2e/
    └── agent-loop.test.ts
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";

describe("ComponentName", () => {
  describe("methodName()", () => {
    it("should do expected behavior", () => {
      // Test implementation
    });

    it("should handle edge case", () => {
      // Test implementation
    });
  });

  describe("error scenarios", () => {
    it("should return error for invalid input", () => {
      // Error handling test
    });
  });
});
```

**BeforeEach/AfterEach:**
- Use for test setup and teardown
- Clean up temp files, reset state

```typescript
beforeEach(() => {
  try {
    unlinkSync(tempFile);
  } catch {
    /* ignore - file may not exist */
  }
});

afterEach(() => {
  try {
    unlinkSync(tempFile);
  } catch {
    /* ignore */
  }
});
```

## Mocking

**Framework:** bun:test built-in mocking (via class implementations)

**Patterns:**

**1. Implement Interface for Mocking:**
```typescript
import type { LLMClient, ChatOptions, ChatResponse } from "@/providers/types.js";

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

**2. Type Casting for Private Members:**
```typescript
// Access private members via type casting for testing
const agentPrivate = agent as unknown as {
  _conversationManager: ConversationManager;
  _activeSkillAllowedTools: string[] | undefined;
};

expect(agentPrivate._activeSkillAllowedTools).toBeUndefined();
```

**3. Dynamic Mock Behavior:**
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
      // Second call: provide final answer after error
      yield { content: "I couldn't find that tool.", done: false };
      yield { done: true };
    }
  }
}
```

**What to Mock:**
- LLM clients (implement `LLMClient` interface)
- File system operations (create temp files)
- External services (API clients)
- Tool dependencies

**What NOT to Mock:**
- Core business logic being tested
- Simple data structures
- Utility functions that are directly tested

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
- Inline in test files for specific test utilities
- Shared fixtures can be placed in `test/utils/` or at top of test files

**Temp Directory Setup:**
```typescript
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempDir = path.join(__dirname, "..", "..", "tmp");

// Ensure temp directory exists
try {
  mkdirSync(tempDir, { recursive: true });
} catch {
  /* ignore */
}
```

## Coverage

**Requirements:** None explicitly enforced

**View Coverage:**
```bash
# bun test does not have built-in coverage
# External tools like c8 or istanbul can be used if needed
```

**Coverage Expectations:**
- Aim for comprehensive coverage of core logic
- Integration tests cover file I/O and persistence
- E2E tests cover agent loop behavior

## Test Types

**Unit Tests:**
- Test single functions/classes in isolation
- Mock all external dependencies
- Location: `test/utils/`, `test/core/agent.test.ts`

**Integration Tests:**
- Test file I/O, persistence, multi-component interaction
- Use temp files for file operations
- Location: `test/memory.test.ts`, `test/tools/file-tools.test.ts`

**E2E Tests:**
- Test full agent loop with mocked LLM
- Location: `test/e2e/agent-loop.test.ts`

## Common Patterns

**Async Testing:**
```typescript
it("should load conversation from file when conversationFile is set", async () => {
  writeFileSync(tempConversationFile, JSON.stringify({ messages: existingConversation }, null, 2));

  const llm = new MockLLMClient();
  const registry = new ToolRegistry();
  const agent = new Agent(llm, registry, {
    conversationFile: tempConversationFile,
  });

  for await (const _chunk of agent.runStream("New message", "mock-model")) {
    // Consume stream
  }

  const history = agentPrivate._conversationManager.getHistory();
  expect(history[0]).toEqual({
    role: "user",
    content: "Previous user message",
  });
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
it("should yield chunks from LLM", async () => {
  const chunks: string[] = [];
  for await (const chunk of agent.runStream("Hello", "mock-model")) {
    if (chunk.content) chunks.push(chunk.content);
  }

  expect(chunks.length).toBeGreaterThan(0);
});
```

**Private Method Testing:**
```typescript
it("should update in-memory history when called", () => {
  const messages = createMessages("User message", "Assistant response");
  agent._updateConversationHistory(messages);

  const history = (agent as unknown as { _conversationManager: ConversationManager })
    ._conversationManager.getHistory();
  expect(history).toEqual(messages);
});
```

**File Cleanup Pattern:**
```typescript
describe("MemoryStore", () => {
  const tempFile = path.join(tempDir, "test-memory.json");

  beforeEach(() => {
    try {
      unlinkSync(tempFile);
    } catch {
      /* ignore */
    }
  });

  afterEach(() => {
    try {
      unlinkSync(tempFile);
    } catch {
      /* ignore */
    }
  });
```

---

*Testing analysis: 2026-01-25*
