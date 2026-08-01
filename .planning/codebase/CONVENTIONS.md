# CONVENTIONS.md — Code Style & Patterns

## Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Files | kebab-case | `stream-processor.ts`, `agent-utils.ts` |
| Classes | PascalCase | `StreamProcessor`, `ToolRegistry` |
| Interfaces | PascalCase | `AgentOptions`, `StreamChunk` |
| Types | PascalCase | `ContextStats`, `ToolExecution` |
| Functions | camelCase | `convertMessages`, `buildContextStats` |
| Variables | camelCase | `fullContent`, `assistantToolCalls` |
| Constants | SCREAMING_SNAKE_CASE | `CORE_TOOLS`, `MAX_OUTPUT_LENGTH` |
| Private members | `_prefix` | `_config`, `_registry` |
| Enums | PascalCase (type) | `AgentType`, `MessageRole` |

## File Organization

### Import Order (Biome enforced)
1. Node built-ins (`node:fs`, `node:path`)
2. External packages (`openai`, `react`, `ink`)
3. Internal relative imports (`./types.js`, `../core/agent.js`)

### Import Style
```typescript
// Node built-ins with node: prefix
import * as fs from "node:fs/promises";
import { spawn } from "node:child_process";

// External packages
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

// Internal: .js extension required
import type { Tool } from "./types.js";
import { Agent } from "../core/agent.js";
```

### Export Style
```typescript
// Named exports preferred
export function convertMessages(messages: Message[]): AnthropicMessage[] { ... }
export class StreamProcessor { ... }
export interface StreamChunk { ... }

// Re-exports for barrel files
export { Agent } from "./agent.js";
export type { AgentOptions } from "./agent.js";
```

## TypeScript Patterns

### Type Annotations
```typescript
// Use import type for type-only imports
import type { ToolDefinition } from "./types.js";

// Use satisfies for type narrowing with validation
const config = {
  provider: "openai",
  model: "gpt-4o",
} satisfies ProviderConfig;
```

### Error Handling
```typescript
// Structured results, never throw for expected failures
try {
  const content = await fs.readFile(filePath, "utf-8");
  return { success: true, data: content };
} catch (err) {
  const error = err as NodeJS.ErrnoException;
  if (error.code === "ENOENT") {
    return { success: false, error: `File not found: ${filePath}` };
  }
  return { success: false, error: error.message };
}
```

### Async Patterns
```typescript
// Async generators for streaming
async *runStream(): AsyncGenerator<AgentStreamChunk, void, unknown> {
  yield { content: "chunk", iterations: 1, done: false };
  yield { content: "", iterations: 1, done: true };
}

// Promise.all for parallel operations
const [result1, result2] = await Promise.all([
  fetchUrl(url1),
  fetchUrl(url2),
]);
```

### Guard Clauses
```typescript
// Move preconditions to top, return early
function processTool(tool: Tool, args: Record<string, unknown>): ToolResult {
  if (!tool) {
    return { success: false, error: "Tool not found" };
  }
  if (!args) {
    return { success: false, error: "Missing arguments" };
  }
  // Main logic here
}
```

## React/Ink Patterns

### Component Style
```typescript
// Function components with TypeScript interfaces
interface MessageProps {
  content: string;
  role: MessageRole;
}

export const Message: React.FC<MessageProps> = ({ content, role }) => (
  <Box>
    <Text>{content}</Text>
  </Box>
);
```

### State Management
```typescript
// Context for shared state
const ChatContext = React.createContext<ChatState | null>(null);

// Hook for consuming context
export function useChat(): ChatState {
  const context = React.useContext(ChatContext);
  if (!context) throw new Error("useChat must be used within ChatProvider");
  return context;
}
```

## Testing Patterns

### Test Structure
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
// Mock LLM client for agent tests
const mockClient: LLMClient = {
  chat: async () => ({ content: "response", finishReason: "stop" }),
  stream: async function* () {
    yield { content: "response" };
  },
  getCapabilities: async () => ({ ... }),
};
```

## Error Codes

| Code | Meaning |
|------|---------|
| `ENOENT` | File not found |
| `EACCES` | Permission denied |
| `EISDIR` | Is a directory |
| `ENOTDIR` | Not a directory |

## Configuration Patterns

### Zod Schema
```typescript
import { z } from "zod";

const ProviderConfigSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional(),
});

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
}
```

### Environment Variables
```typescript
// Nullish coalescing for defaults
const apiKey = config.providers?.openai?.apiKey
  ?? process.env.OPENAI_API_KEY
  ?? "";
```

## Documentation Patterns

### JSDoc
```typescript
/**
 * Convert internal Message[] to Anthropic API format.
 *
 * Anthropic requires:
 * - System messages extracted to a separate `system` parameter
 * - Tool results appended to the preceding user message
 */
export function convertMessages(messages: Message[]): { system?: string; messages: AnthropicMessage[] } {
  // ...
}
```

### ADR (Architecture Decision Record)
```markdown
# ADR-014: StreamProcessor Extraction

## Status
Accepted

## Context
Agent.runStream() was ~400 lines handling multiple concerns.

## Decision
Extract the main iteration loop into StreamProcessor class.

## Consequences
- agent.ts reduced to ~40 lines of setup + delegation
- StreamProcessor is independently testable
- No circular dependencies (imports from agent-utils.ts)
```
