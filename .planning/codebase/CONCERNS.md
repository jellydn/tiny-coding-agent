# Codebase Concerns

**Analysis Date:** 2026-01-25

## Tech Debt

### Global MCP Manager Pattern

**Files:** `src/mcp/manager.ts`, `src/cli/main.tsx`, `src/core/agent.ts`

The MCP manager is implemented as a deprecated global singleton pattern. The codebase explicitly marks this as technical debt with `@deprecated` JSDoc annotations:

```typescript
// src/mcp/manager.ts:8-11
/**
 * @deprecated Global MCP manager creates implicit dependencies. Use dependency injection instead.
 * Will be removed in a future version. Pass McpManager instances explicitly to components.
 */
```

**Impact:** This pattern creates hidden dependencies across the codebase, making testing harder and introducing tight coupling. Components that need MCP functionality cannot easily be tested in isolation without the global state.

**Fix approach:** Refactor to use dependency injection. Pass `McpManager` instances explicitly to `Agent` constructor and other components that need MCP access.

### Large Monolithic CLI Entry Point

**File:** `src/cli/main.tsx` (1418 lines)

The main CLI file is a monolithic entry point containing 10+ handler functions and multiple responsibilities:

- Argument parsing
- Command routing (`chat`, `run`, `config`, `status`, `memory`, `skill`, `mcp`)
- Tool setup and registration
- LLM client creation
- Agent initialization
- UI rendering

**Impact:** Difficult to maintain, test, and extend. Violates Single Responsibility Principle.

**Fix approach:** Extract handlers into separate modules in `src/cli/handlers/` directory.

### Deprecated Agent Health Check Method

**File:** `src/core/agent.ts:811`

The `healthCheck()` method references the deprecated global MCP manager pattern:

```typescript
// src/core/agent.ts:825-826
// Note: This uses deprecated global pattern - in future, inject MCP manager
const mcpManager = (await import("../mcp/manager.js")).getGlobalMcpManager();
```

---

## Security Considerations

### Partial API Key Redaction

**File:** `src/core/agent.ts:65-69`

API keys are only redacted in verbose mode output:

```typescript
export function redactApiKey(key?: string): string {
  if (!key) return "(not set)";
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
```

**Risk:** If verbose logging is accidentally enabled in production, API keys could be exposed in logs.

**Recommendation:** Consider always redacting in logs, or add a safeguard preventing verbose mode in production environments.

### Environment Variable Interpolation Whitelist

**File:** `src/config/loader.ts:132-152`

The config loader only checks for sensitive patterns on non-whitelisted environment variables:

```typescript
if (
  !envVar.startsWith("OPENAI") &&
  !envVar.startsWith("ANTHROPIC") &&
  !envVar.startsWith("AWS")
) {
  if (containsSensitivePattern(keyPath)) {
    console.warn(/* warning */);
  }
}
```

**Risk:** Other API keys (Ollama, OpenRouter, OpenCode) are not warned about even if they appear to contain sensitive patterns. Users might not realize they should use environment variables for these providers.

**Recommendation:** Add all provider prefixes to the whitelist or implement a more comprehensive check.

### Bash Tool Shell Metacharacters

**File:** `src/tools/bash-tool.ts:102-125`

Shell metacharacters are detected and warned about but not blocked:

```typescript
const metacharacters = detectShellMetacharacters(command);
if (metacharacters.length > 0) {
  const warning = `[Security] Command contains shell metacharacters: ${metacharacters.join(", ")}. This is allowed for legitimate shell usage but review the command if unexpected.`;
  console.warn(warning);
}
```

**Risk:** While destructive commands are blocked, sophisticated injection attacks using shell metacharacters might bypass detection in edge cases.

**Recommendation:** Consider adding a strict mode that blocks commands with metacharacters when needed.

### MCP Server Environment Variables

**File:** `src/config/schema.ts:12-16`

MCP server configurations can include environment variables:

```typescript
export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}
```

**Risk:** MCP servers inherit the filtered environment from the bash tool, but this filtering happens separately. Any mismatch in filtering logic could expose sensitive environment variables to MCP servers.

**Recommendation:** Centralize environment filtering logic and document which variables are passed to MCP servers.

---

## Performance Bottlenecks

### Synchronous Token Counting

**File:** `src/core/tokens.ts`, `src/core/memory.ts`

Token counting is done synchronously using `tiktoken`, which can be slow for large contexts:

```typescript
// src/core/tokens.ts
export function countTokensSync(text: string): number {
  // Synchronous call to tiktoken encoder
}

function calculateMessageTokens(messages: Message[]): number {
  return messages.reduce((sum, msg) => sum + countTokensSync(msg.content), 0);
}
```

**Impact:** On large conversation histories, token counting can cause visible UI lag.

**Recommendation:** Consider caching token counts for unchanged messages, or moving token counting to a worker thread.

### Memory Store In-Memory Sorting

**File:** `src/core/memory.ts:107-111`

Every call to `list()` performs an in-memory sort:

```typescript
list(): Memory[] {
  return Array.from(this._memories.values()).sort((a, b) => {
    return new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime();
  });
}
```

**Impact:** Frequent `list()` calls (used in memory management commands) cause unnecessary recomputation.

**Recommendation:** Maintain a sorted data structure (e.g., balanced tree or doubly-linked list) for LRU ordering.

### Inefficient Provider Cache Eviction

**File:** `src/core/agent.ts:286-298`

Cache eviction iterates through all entries to find the oldest:

```typescript
if (this._providerCache.size >= this._providerCacheMaxSize) {
  let oldestKey: string | null = null;
  let oldestTimestamp = Infinity;
  for (const [key, entry] of this._providerCache.entries()) {
    if (entry.timestamp < oldestTimestamp) {
      oldestTimestamp = entry.timestamp;
      oldestKey = key;
    }
  }
  if (oldestKey) {
    this._providerCache.delete(oldestKey);
  }
}
```

**Impact:** O(n) eviction complexity. With default cache size of 10, this is negligible, but could become problematic if cache size is increased.

**Recommendation:** Use a Min-Heap or LinkedHashMap for O(1) eviction.

---

## Fragile Areas

### Model Capability Hardcoding

**File:** `src/providers/anthropic.ts:272-281`

Model context windows are hardcoded:

```typescript
const modelContextWindow: Record<string, number> = {
  "claude-3-5-sonnet-20241022": 200000,
  "claude-3-5-haiku-20241022": 200000,
  // ... more models
};
```

**Why fragile:** New model releases require code changes. Unknown models fall back to 200k with a warning:

```typescript
if (!contextWindow) {
  console.warn(
    `[WARN] Unknown model "${model}" - using default context window of 200000 tokens. ` +
      "Context limits may be inaccurate. Consider updating the model registry.",
  );
}
```

**Impact:** Context limits may be miscalculated for new models, leading to suboptimal token allocation.

### ThinkingTagFilter Buffer Edge Cases

**File:** `src/cli/main.tsx:62-104`

The thinking tag filter has buffer management that could cause issues:

```typescript
if (this.buffer.length > 100) {
  this.buffer = this.buffer.slice(-20);
}
break;
```

**Why fragile:** If a thinking block is very large (more than 100 chars before closing tag), the buffer is truncated, potentially losing content. This could cause malformed output.

**Impact:** Edge case where `</thinking>` is far from `<thinking>` could result in missing content.

### Config Validation Gaps

**File:** `src/config/schema.ts:56-156`

Config validation is basic and doesn't catch all issues:

- No validation for `baseUrl` format
- No validation for `mcpServers` command existence
- No circular dependency detection in skill directories

**Impact:** Misconfigured setups may fail at runtime with unclear error messages.

### Provider Type Detection Fallback

**File:** `src/providers/factory.ts`

Model-to-provider detection has a fallback that silently uses the default provider:

```typescript
// Detect provider type from model name or use default
const providerType = detectProvider(model);
const cached = this._providerCache.get(providerType);
// ...
```

**Why fragile:** If a model name doesn't match any known pattern, it may be incorrectly routed.

---

## Known Bugs

### Memory Store Silent Failure on Corrupted File

**File:** `src/core/memory.ts:279-282`

Corrupted JSON files are silently ignored:

```typescript
} catch (err) {
  console.error(`[MemoryStore] Failed to load memories from ${this._filePath}: ${err}`);
  console.error("[MemoryStore] Continuing with empty memory store");
}
```

**Impact:** Users may lose memories without knowing the file was corrupted. No recovery attempt is made.

### Signal Handler Duplication

**File:** `src/core/memory.ts:220-234`

Signal handlers are registered but never removed:

```typescript
registerSignalHandlers(): void {
  if (this._signalHandlersRegistered || typeof process === "undefined") return;
  this._signalHandlersRegistered = true;
  process.on("SIGTERM", async () => { /* ... */ });
  process.on("SIGINT", async () => { /* ... */ });
}
```

**Impact:** If `registerSignalHandlers()` is called multiple times (e.g., in tests or multiple MemoryStore instances), handlers accumulate. The check prevents duplicates but doesn't clean up on instance destruction.

---

## Test Coverage Gaps

### Untested: Config Interpolation Edge Cases

**Files:** `src/config/loader.ts`, `src/config/schema.ts`

Environment variable interpolation with edge cases (missing vars, circular references) are not explicitly tested.

### Untested: Provider Capability Caching

**File:** `src/providers/anthropic.ts:267-307`

The capabilities cache behavior under concurrent access is not tested.

### Untested: Tool Registry Conflicts

**File:** `src/tools/registry.ts`

Tool name collision behavior and resolution strategy is not tested.

### Untested: MCP Server Restart Logic

**File:** `src/mcp/manager.ts:112-118`

The `restartServer()` method and its interaction with connection state is not tested.

---

## Dependencies at Risk

### tiktoken (^1.0.15)

**Risk:** This is a native module that requires prebuilds. May have compatibility issues with newer Node.js versions or ARM architectures.

**Impact:** Token counting (core functionality) could fail on some platforms.

### @modelcontextprotocol/sdk (^1.25.2)

**Risk:** MCP SDK is relatively new and may have breaking changes.

**Impact:** MCP functionality could break on minor version updates.

---

## Missing Critical Features

### Conversation Persistence Without ConversationFile

**File:** `src/core/conversation.ts`

The conversation manager only saves to file if `conversationFile` is configured. In-memory conversations are lost on exit.

**Problem:** Users in chat mode without file persistence lose conversation history on crash or SIGINT.

### No Graceful Degradation for Token Limits

**File:** `src/core/agent.ts`

When context exceeds limits, the system falls back to simple truncation without intelligent message selection.

**Problem:** Important context may be lost while less relevant messages are retained.

---

## Scaling Limits

### Provider Cache Size

**File:** `src/core/agent.ts:194-196`

```typescript
private _providerCache: Map<string, { client: LLMClient; timestamp: number }> = new Map();
private static readonly DEFAULT_PROVIDER_CACHE_SIZE = 10;
```

**Current capacity:** 10 unique provider configurations

**Limit:** Users with many provider configurations (multiple OpenAI-compatible endpoints) may experience cache thrashing.

### Tool Registry Linear Search

**File:** `src/tools/registry.ts`

Tool lookups appear to use linear search for tool execution.

**Limit:** Performance degradation when hundreds of tools are registered (especially with multiple MCP servers).

---

*Concerns audit: 2026-01-25*
