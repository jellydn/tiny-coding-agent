# TESTING.md — Test Structure & Patterns

## Framework

- **Runner**: [Bun test](https://bun.sh/docs/cli/test) (built-in)
- **Assertions**: `expect()` from `bun:test`
- **Coverage**: Not configured (manual coverage assessment)
- **CI**: Tests run in GitHub Actions on every push/PR

## Test Statistics

- **Total test files**: 84
- **Total test lines**: ~17,000
- **Passing**: 1,311 / 1,313 (99.85%)
- **Failing**: 2 (pre-existing, environment-dependent)

## Directory Structure

```
test/
├── core/                    # Core module tests
│   ├── agent.test.ts        # Agent unit tests
│   ├── agent-helpers.test.ts
│   ├── agent-fallback.test.ts
│   ├── memory.test.ts       # MemoryStore tests
│   ├── memory-helpers.test.ts
│   ├── conversation.test.ts
│   ├── conversation-errors.test.ts
│   └── context-budget.test.ts
├── tools/                   # Tool tests
│   ├── bash-tool.test.ts
│   ├── file-tools.test.ts
│   ├── search-tools.test.ts
│   ├── gitignore.test.ts
│   ├── confirmation.test.ts
│   ├── registry.test.ts
│   ├── skill-tool.test.ts
│   ├── skill-tool-allowed-tools.test.ts
│   └── plugin-loader.test.ts
├── providers/               # Provider tests
│   ├── anthropic.test.ts
│   ├── anthropic-provider.test.ts
│   ├── ollama.test.ts
│   ├── openai-provider.test.ts
│   ├── clinepass.test.ts
│   └── model-registry.test.ts
├── agents/                  # Agent type tests
│   ├── plan-agent.test.ts
│   ├── build-agent.test.ts
│   ├── explore-agent.test.ts
│   ├── state.test.ts
│   └── plan-grammar.test.ts
├── cli/                     # CLI tests
│   ├── main.test.tsx
│   ├── upgrade.test.ts
│   ├── integration.test.ts
│   ├── chat-commands.test.ts
│   └── handlers/
│       ├── plan.test.ts
│       ├── agent.test.ts
│       └── state.test.ts
├── skills/                  # Skill tests
│   ├── prompt.test.ts
│   ├── parser.test.ts
│   ├── loader.test.ts
│   └── builtin-registry.test.ts
├── observability/           # Observability tests
│   ├── telemetry.test.ts
│   ├── token-usage.test.ts
│   ├── cost.test.ts
│   ├── agent-observability.test.ts
│   ├── redact.test.ts
│   ├── langfuse.test.ts
│   ├── trace-context.test.ts
│   └── logger.test.ts
├── mcp/                     # MCP tests
│   ├── manager.test.ts
│   └── mcp-errors.test.ts
├── config/                  # Config tests
│   └── loader.test.ts
├── security/                # Security tests
│   ├── command-injection.test.ts
│   ├── file-validation.test.ts
│   ├── bash-env.test.ts
│   └── security-suite.test.ts
├── utils/                   # Utility tests
│   ├── command.test.ts
│   └── xml.test.ts
├── ui/                      # UI tests
│   └── utils.test.ts
├── performance/             # Performance tests
│   └── benchmarks.test.ts
└── e2e/                     # End-to-end tests
    └── agent-loop.test.ts
```

## Test Patterns

### Unit Tests
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

### Mocking
```typescript
// Mock LLM client
const mockClient: LLMClient = {
  chat: async () => ({ content: "response", finishReason: "stop" }),
  stream: async function* () {
    yield { content: "response" };
  },
  getCapabilities: async () => ({
    modelName: "test",
    supportsTools: true,
    supportsStreaming: true,
    supportsSystemPrompt: true,
    supportsToolStreaming: true,
    supportsThinking: false,
    contextWindow: 128000,
    maxOutputTokens: 4096,
    isVerified: false,
    source: "fallback",
  }),
};
```

### Provider Tests (HTTP Mocking)
```typescript
// Mock fetch for provider tests
global.fetch = mock(async () => ({
  ok: true,
  json: async () => ({
    choices: [{ message: { content: "response" } }],
  }),
})) as typeof fetch;
```

### Integration Tests
```typescript
// Full agent loop test with mocked LLM
describe("Agent loop", () => {
  it("should execute tool calls and return final answer", async () => {
    const agent = new Agent(mockClient, toolRegistry, { maxIterations: 5 });
    const chunks: AgentStreamChunk[] = [];
    
    for await (const chunk of agent.runStream("test", "model")) {
      chunks.push(chunk);
    }
    
    expect(chunks[chunks.length - 1].done).toBe(true);
  });
});
```

### Security Tests
```typescript
// Command injection prevention
describe("Security", () => {
  it("should reject shell metacharacters in file paths", () => {
    const result = validatePath("src/../../etc/passwd");
    expect(result.success).toBe(false);
  });

  it("should reject command injection in bash tool", () => {
    const result = isDestructiveCommand("echo hello; rm -rf /");
    expect(result).toBe(true);
  });
});
```

## Running Tests

```bash
# Run all tests
bun test

# Run specific file
bun test test/core/agent.test.ts

# Run tests matching pattern
bun test memory

# Watch mode for TDD
bun test:watch

# Run with timeout
bun test --timeout 30000
```

## Test Conventions

### File Naming
- Test files: `<module>.test.ts`
- Test directories mirror source: `test/core/`, `test/tools/`, etc.

### Cleanup
- Use `beforeEach`/`afterEach` for file system cleanup
- Use temp files in `/tmp/` for file-based tests
- Clean up mock state between tests

### Assertions
- Prefer specific matchers: `toBe()`, `toEqual()`, `toContain()`
- Use `expect.objectContaining()` for partial matches
- Use `expect.arrayContaining()` for array assertions

### Environment
- Tests run in isolated environment
- No external API calls (all mocked)
- File system operations use temp directories

## Coverage Assessment

### High Coverage
- `core/memory.test.ts` — comprehensive memory operations
- `tools/file-tools.test.ts` — file operation edge cases
- `security/` — security attack vectors
- `providers/anthropic.test.ts` — provider conversion

### Medium Coverage
- `core/agent.test.ts` — agent loop with mocked LLM
- `tools/bash-tool.test.ts` — command execution
- `skills/` — skill loading and parsing

### Low Coverage
- `core/stream-processor.ts` — tested via integration only
- `ui/` — limited UI component testing
- `cli/handlers/` — handler logic partially tested

## Pre-existing Failures

### 1. `handlePlanCommand > should show error when state file not found`
- **Cause**: Environment-dependent file system state
- **Impact**: Low (CLI handler only)
- **Fix**: Add conditional skip for CI environments

### 2. `handleReviewCommand > should show error when config file cannot be read`
- **Cause**: Environment-dependent file system state
- **Impact**: Low (CLI handler only)
- **Fix**: Add conditional skip for CI environments

## Test Generation

### Using the test-generator Skill
```bash
# Generate tests for a module
/commit-atomic  # Groups changes into atomic commits
```

### Manual Test Creation
```typescript
// Template for new test file
import { describe, it, expect, beforeEach } from "bun:test";
import { ModuleToTest } from "../../src/path/to/module.js";

describe("ModuleToTest", () => {
  beforeEach(() => {
    // Setup
  });

  it("should handle basic case", () => {
    // Arrange
    // Act
    // Assert
  });

  it("should handle edge case", () => {
    // ...
  });
});
```
