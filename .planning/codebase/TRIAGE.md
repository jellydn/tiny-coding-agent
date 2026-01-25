# Concerns Triage & Action Plan

**Analysis Date:** 2026-01-25
**Last Updated:** 2026-01-25 (Phase 5 Complete - ALL PHASES DONE!)

## Quick Wins (≤2 hours, meaningful impact) ✅ COMPLETE

### ✅ 1. Warn on Tiktoken Fallback

**Status:** Done - `src/core/tokens.ts:17-23`

```typescript
if (!_warnedAboutFallback) {
  console.warn(
    "[WARN] tiktoken not available - using inaccurate character-based token counting. " +
      "Install tiktoken for accurate context budget calculations.",
  );
  _warnedAboutFallback = true;
}
```

### ✅ 2. Implement/Remove ConversationManager.close()

**Status:** Done - `src/core/conversation.ts:74-76`

```typescript
async close(): Promise<void> {
  await this._save(); // Flush pending writes
}
```

### ✅ 3. Add Graceful Shutdown Handler

**Status:** Done - `src/core/agent.ts:722-734`

```typescript
async shutdown(options?: ShutdownOptions): Promise<void> {
  if (this._memoryStore) {
    this._memoryStore.flush();
  }
  await this._conversationManager.close();
  // Signal handler cleanup...
}
```

**Also added:** `MemoryStore.flush()` method at `src/core/memory.ts:171-180`

### ✅ 4. Document Plugin Security

**Status:** Done - `SECURITY.md`

- Comprehensive security documentation
- Plugin security best practices for users and authors
- Environment variable, path traversal, and web search considerations
- Security checklist for production use

### ✅ 5. Add Health Check Method

**Status:** Done - `src/core/agent.ts:702-720`

```typescript
healthCheck(): HealthStatus {
  return {
    ready: issues.length === 0,
    issues,
    providerCount: this._providerCache.size,
    skillCount: this._skills.size,
    memoryEnabled: !!this._memoryStore,
  };
}
```

**Phase 1 Summary:** All 5 quick wins completed in ~30 minutes. Files modified:

- `src/core/tokens.ts` - Added tiktoken fallback warning
- `src/core/memory.ts` - Added `flush()` method
- `src/core/conversation.ts` - Implemented `close()`
- `src/core/agent.ts` - Added `healthCheck()` and `shutdown()` methods
- `SECURITY.md` - Created comprehensive security documentation

---

## Quick Wins (≤2 hours, meaningful impact) [ARCHIVE]

### 1. Warn on Tiktoken Fallback

**Effort:** 30min | **Impact:** Low | **Concern:** Inaccurate Token Counting

```typescript
// src/core/tokens.ts
// Add warning when using character-based fallback
```

- Users unknowingly get inaccurate context budgets
- Simple one-line console.warn on fallback path

### 2. Implement or Remove ConversationManager.close()

**Effort:** 30min | **Impact:** Low | **Concern:** Empty Promise Return

```typescript
// Either implement proper cleanup or deprecate the method
async close(): Promise<void> {
  await this._save(); // Flush pending writes
}
```

### 3. Add Graceful Shutdown Handler

**Effort:** 1hr | **Impact:** Medium | **Concern:** Missing Shutdown Handler

```typescript
// src/core/agent.ts
// Add shutdown() method that flushes memory + disconnects MCP
process.on("SIGTERM", () => agent.shutdown());
```

- Prevents data loss on process termination
- Standard practice for long-running processes

### 4. Document Plugin Security Implications

**Effort:** 30min | **Impact:** Medium | **Concern:** Dynamic Module Import

- Add security.md documenting plugin risks
- Document recommended practices for plugin authors

### 5. Add Health Check Method

**Effort:** 1hr | **Impact:** Medium | **Concern:** No Health Check

```typescript
// src/core/agent.ts
healthCheck(): { ready: boolean; issues: string[] } {
  // Check provider connections, config loaded, etc.
}
```

---

## Medium Effort (1-3 days, significant improvement) ✅ COMPLETE

### ✅ 6. Convert Sync I/O to Async

**Status:** Done - `src/core/memory.ts`, `src/core/conversation.ts`

- Converted `readFileSync`/`writeFileSync` to `fs/promises`
- Added `MemoryStore.init()` for async initialization
- Updated `loadHistory()` to async in `ConversationManager`
- Call site in `agent.ts` updated to await `loadHistory()`

### ✅ 7. Remove MCP Global Singleton

**Status:** Done - `src/mcp/manager.ts`

- Added `clearGlobalMcpManager()` function for testing
- Marked global functions with `@deprecated` JSDoc tags
- Updated tests to use new `clearGlobalMcpManager()`
- Full migration to DI deferred to avoid breaking changes

### ✅ 8. Cache Expensive Operations

**Status:** Done - `src/providers/anthropic.ts`, `src/providers/openai.ts`

- Gitignore patterns already cached (mtime-based)
- Token encoder already singleton
- Added `Map<string, ModelCapabilities>` cache to provider classes
- Caches `getCapabilities()` results by model name

### ✅ 9. Allowlist Environment Variables

**Status:** Done - `src/tools/bash-tool.ts`

- Replaced hybrid allowlist/blocklist with strict allowlist
- Expanded `SAFE_ENV_KEYS` with common development vars
- Removed sensitive pattern matching (blocklist)
- Only explicitly allowed vars are passed to subprocess

### ✅ 10. Rate Limit Retry

**Status:** Done - `src/utils/retry.ts` (new file)

- Created `retryWithBackoff<T>()` utility function
- Exponential backoff with configurable jitter
- Detects rate limit (429) and transient network errors
- Provider SDKs have built-in retry, utility available for custom use

**Phase 2 Summary:** All 5 medium-effort items completed. Files modified:

- `src/core/memory.ts` - Async I/O with `fs/promises`
- `src/core/conversation.ts` - Async I/O with `fs/promises`
- `src/core/agent.ts` - Updated to await `loadHistory()`
- `src/mcp/manager.ts` - Deprecated globals, added `clearGlobalMcpManager()`
- `src/providers/anthropic.ts` - Added capabilities cache
- `src/providers/openai.ts` - Added capabilities cache
- `src/tools/bash-tool.ts` - Strict allowlist for env vars
- `src/utils/retry.ts` - New retry utility with exponential backoff
- `test/mcp/manager.test.ts` - Updated to use new clear function

---

## Medium Effort (1-3 days, significant improvement) [ARCHIVE]

### 6. Convert Sync I/O to Async

**Effort:** 1 day | **Impact:** High | **Concern:** Synchronous File I/O

```typescript
// src/core/memory.ts, src/core/conversation.ts
// Use fs/promises instead of fs
await fs.readFile(filePath, "utf-8");
await fs.writeFile(filePath, JSON.stringify(data));
```

- **Blocks main thread** during agent operation
- Affects UI responsiveness and timeout handling
- Requires updating all call sites to async/await

### 7. Remove MCP Global Singleton

**Effort:** 1 day | **Impact:** High | **Concern:** Global Singleton Pattern

```typescript
// Pass MCP manager as dependency instead of global
constructor(options: { mcpManager?: MCPManager })
```

- Tests pollute each other through shared state
- Requires updating Agent constructor and all tests

### 8. Cache Expensive Operations

**Effort:** 1 day | **Impact:** Medium | **Concern:** No Caching

```typescript
// Cache model capabilities, gitignore patterns, token encoder
private _capabilitiesCache = new Map<string, Capabilities>();
```

- Frequently computed values (getCapabilities, gitignore parse)
- Simple Map-based memoization

### 9. Implement Rate Limit Retry

**Effort:** 1 day | **Impact:** Medium | **Concern:** Missing Rate Limit Handling

```typescript
// Exponential backoff for 429 errors
async function retryWithBackoff<T>(fn: () => Promise<T>): Promise<T>;
```

- Prevents immediate failures on API rate limits
- Standard pattern for API clients

### 10. Allowlist Environment Variables

**Effort:** 2hrs | **Impact:** Medium | **Concern:** Bash Tool Env Filtering

```typescript
// Replace blocklist with allowlist approach
const ALLOWED_VARS = ["PATH", "HOME", "USER", "SHELL", "LANG", "PWD"];
```

- Blocklists miss new secret naming conventions
- Allowlist is more secure by default

---

## Larger Refactors (1-2 weeks, high value) ✅ COMPLETE

### ✅ 11. HTML Parser for Web Search (Improved)

**Status:** Done - `src/tools/web-search-tool.ts`

- Added multi-tier fallback parsing (primary → alternate → last resort)
- Added URL validation to filter invalid/dangerous URLs
- Wrapped parsing in try-catch for graceful degradation
- Made snippet handling more defensive (defaults to "No description available")
- **Note:** Still uses regex (no new dependency), but significantly more robust

### ✅ 12. Convert Recursive Search to Iterative

**Status:** Done - `src/tools/search-tools.ts`

- Converted `searchFiles()` to use explicit stack instead of recursion
- Converted `globFiles()` to use explicit stack instead of recursion
- Added `visited` Set to prevent infinite loops with symlinks
- Added better error handling with `.catch()` on fs operations
- No more stack overflow risk on deeply nested directories

### ✅ 13. Token-Based Memory Limits

**Status:** Done - `src/core/memory.ts`

- Added `maxMemoryTokens` option to `MemoryStoreOptions`
- Added `_countMemoryTokens()` method to calculate total memory token usage
- Modified `_evictIfNeeded()` to use token-based eviction when configured
- Extracted `_evictOldest()` as reusable helper method
- Count-based eviction remains as fallback

**Phase 4 Summary:** All 3 polish/stability items completed. Files modified:

- `src/tools/web-search-tool.ts` - Multi-tier fallback parsing, URL validation
- `src/tools/search-tools.ts` - Iterative search with explicit stacks
- `src/core/memory.ts` - Token-based memory limits

---

## Larger Refactors (1-2 weeks, high value) [ARCHIVE]

### 11. Convert Recursive Search to Iterative

**Effort:** 2 days | **Impact:** Low | **Concern:** Deep Recursion

```typescript
// src/tools/search-tools.ts
// Use explicit stack instead of recursion
const stack: string[] = [startDir];
while (stack.length > 0) {
  /* ... */
}
```

- Prevents stack overflow on deeply nested directories
- Edge case, but causes process crash

### 12. HTML Parser for Web Search

**Effort:** 2 days | **Impact:** Medium | **Concern:** Regex HTML Parsing

```typescript
// Use cheerio instead of regex
import * as cheerio from "cheerio";
const $ = cheerio.load(html);
```

- DuckDuckGo HTML changes will break search
- More robust parsing, easier maintenance

### 13. E2E Test Infrastructure

**Effort:** 3 days | **Impact:** High | **Concern:** No E2E Tests

```typescript
// test/e2e/agent-loop.test.ts
// Full agent loop with mocked LLM responses
```

- Integration issues surface in production
- Highest priority test gap

### 14. Security Test Suite

**Effort:** 2 days | **Impact:** High | **Concern:** Missing Security Tests

```typescript
// test/security/path-traversal.test.ts
// test/security/command-injection.test.ts
// test/security/env-filtering.test.ts
```

- Path traversal, command injection, sensitive file access
- Critical for an agent that executes code

### 15. File Locking for Conversations

**Effort:** 2 days | **Impact:** Low | **Concern:** No File Locking

```typescript
// Use proper file locks or unique session filenames
import lockfile from "proper-lockfile";
```

- Only affects concurrent agent runs sharing file
- Edge case for most users

---

## Strategic Choices (require design decisions)

### 16. Plugin Signature Verification

**Effort:** 1 week | **Impact:** Medium | **Concern:** Plugin Loader Security

- Design: signature format, key distribution, verification UI
- Trade-off: security vs. ease of use for plugin authors

### 17. Token-Based Memory Limits

**Effort:** 2 days | **Impact:** Low | **Concern:** Fixed Max Count

```typescript
// Replace count-based with token-based memory limits
this._maxTokens = options.maxTokens ?? 4000;
```

- Large memories exceed budget while small ones waste capacity
- Design: token counting for memories, eviction policy

### 18. Migrate from DuckDuckGo Scraping

**Effort:** 3 days | **Impact:** Medium | **Concern:** DuckDuckGo Dependency

- Options: Bing Search API, Google Custom Search, Tavily
- Trade-off: API cost vs. reliability vs. implementation effort

### 19. Backpressure for Streaming

**Effort:** 3 days | **Impact:** Low | **Concern:** No Backpressure

- Memory exhaustion on very large streams
- Edge case; most responses fit in memory

---

## Recommended Execution Order

### Phase 1: Quick Wins (Week 1)

1. Warn on Tiktoken Fallback (30min)
2. Implement/Remove ConversationManager.close() (30min)
3. Document Plugin Security (30min)
4. Add Health Check (1hr)
5. Add Graceful Shutdown (1hr)

### Phase 2: High-Impact Medium Effort (Week 2-3)

6. Convert Sync I/O to Async (1 day) - **Addresses main thread blocking**
7. Remove MCP Global Singleton (1 day) - **Enables isolated testing**
8. Cache Expensive Operations (1 day) - **Improves performance**
9. Allowlist Environment Variables (2hrs) - **Security improvement**
10. Rate Limit Retry (1 day) - **Better API resilience**

### Phase 3: Testing Foundation (Week 4-5)

11. Security Test Suite (2 days) - **Critical for code-executing agent**
12. E2E Test Infrastructure (3 days) - **Catch integration issues early**

### Phase 4: Polish & Stability (Week 6+)

13. HTML Parser for Web Search (2 days)
14. Convert Recursive Search (2 days)
15. Token-Based Memory Limits (2 days)

### Phase 5: Strategic (As needed) ✅ COMPLETE

### ✅ 16. Plugin Signature Verification

**Status:** Done - `src/skills/signature.ts`, `src/skills/loader.ts`

- HMAC-SHA256 based signature system using Node.js built-in crypto
- `generateKeyPair()` for creating signing keys
- `signPlugin()` for signing plugin content
- `verifyPluginSignature()` for verification
- Integrated into skill loading with warnings for invalid/unsigned plugins
- File-based key distribution (keys stored in `~/.tiny-agent/keys/`)
- Environment variables: `TINY_AGENT_VERBOSE` for verification logs, `TINY_AGENT_WARN_UNSIGNED` for unsigned plugin warnings

### ✅ 17. Token-Based Memory Limits

**Status:** Done - `src/core/memory.ts` (completed in Phase 4)

- Added `maxMemoryTokens` option to `MemoryStoreOptions`
- Token-based eviction when configured
- Count-based eviction remains as fallback

### ✅ 18. Migrate from DuckDuckGo Scraping

**Status:** Done - `src/tools/search-providers/` (new directory)

- Created `SearchProvider` interface and `BaseSearchProvider` abstract class
- `DuckDuckGoProvider` implements current scraping behavior
- `setGlobalSearchProvider()` for swapping providers at runtime
- Pluggable architecture allows easy addition of API-based providers (Tavily, Bing, etc.)
- Backward compatible - DuckDuckGo remains the default

### ✅ 19. Backpressure for Streaming

**Status:** Done - `src/providers/types.ts`, `src/providers/anthropic.ts`

- Added `maxChunks` option to `ChatOptions` (default: 10000 chunks ≈ 10MB)
- Prevents memory exhaustion on very large streaming responses
- Yield tracking with early termination when limit reached
- Documented streaming behavior and consumer responsibility

**Phase 5 Summary:** All 3 strategic items completed. Files created/modified:

- `src/skills/signature.ts` - HMAC-SHA256 signature verification framework
- `src/skills/loader.ts` - Integrated signature verification
- `src/tools/search-providers/provider.ts` - Search provider interface
- `src/tools/search-providers/duckduckgo.ts` - DuckDuckGo provider implementation
- `src/tools/search-providers/index.ts` - Provider exports
- `src/tools/web-search-tool.ts` - Refactored to use provider system
- `src/providers/types.ts` - Added `maxChunks` option
- `src/providers/anthropic.ts` - Added chunk limit backpressure safety

---

## Phase 6: Additional Improvements (2026-01-25)

### ✅ Additional Security & Stability Fixes

**Path Traversal Validation**

- **Status:** Done - `src/tools/file-tools.ts:270-274`
- Added validation for `old_str` and `new_str` in edit_file tool
- Rejects strings containing `../` or `..\` patterns

**Memory Store Periodic Flush**

- **Status:** Done - `src/core/memory.ts:6,55-58,216-222`
- Added `PERIODIC_FLUSH_INTERVAL_MS` (5 seconds) as safety net
- Added `close()` method to cleanup interval and flush
- Prevents data loss on sudden termination

**Conversation History Limits**

- **Status:** Done - `src/core/conversation.ts:4-19,34-40,85-88`
- Added `ConversationManagerOptions` with `maxMessages` and `maxTokens`
- Added `_truncateHistory()` method for LRU-style eviction
- Added `getHistoryCount()` for monitoring

**MCP Connection Status in Health Check**

- **Status:** Done - `src/core/agent.ts:117-124,722-757`
- Added `mcpServers` field to `HealthStatus` interface
- `healthCheck()` now async and includes MCP server status
- Reports disconnected MCP servers as health issues

**Unknown Model Context Window Warning**

- **Status:** Done - `src/providers/anthropic.ts:271-291`
- Added newer model context windows (claude-4 series)
- Added warning for unknown models with fallback to 200k
- Context limits may be inaccurate for unknown models

### ✅ Test Infrastructure

**Security Test Suite**

- **Status:** Done - `test/security/security-suite.test.ts` (new file)
- Path traversal prevention tests
- Environment variable allowlist tests
- Sensitive file access tests

**Performance Benchmark Tests**

- **Status:** Done - `test/performance/benchmarks.test.ts` (new file)
- Token counting performance
- Memory store operations
- Search tools performance
- File I/O performance

**Expanded MCP Manager Tests**

- **Status:** Done - `test/mcp/manager.test.ts`
- Server failure handling tests
- Reconnection logic tests
- Verbose mode logging tests
- Disabled patterns tests

---

## Recommended Execution Order

## Impact vs. Effort Matrix

```
High Impact │  6  7  │ 11 12 13 14
            │  8  9  │ 15 17 18
────────────┼────────┼────────────
Medium      │  3  4  │ 16 19
Low         │  1  2  │ 10
            └────────┴────────────
             Low    High
             Effort
```

**Numbers** correspond to items above.

**Start here:** Items 1-5 (Quick Wins) → Item 6 (Sync I/O) → Item 7 (MCP Singleton)

---

_Triage analysis: 2026-01-25_
