# Codebase Concerns

**Analysis Date:** 2026-01-25

## Tech Debt

### Inaccurate Token Counting Fallback

**Issue:** The token counting system falls back to a character-based heuristic (`text.length / 4`) when `tiktoken` is unavailable, which produces inaccurate token counts.

**Files:** `src/core/tokens.ts:21-23`

**Impact:** Context budget calculations may be significantly off when tiktoken fails to load, leading to either truncated conversations or exceeding model token limits.

**Fix approach:** Ensure tiktoken loads reliably, or implement a more accurate fallback using word-based counting with language-specific adjustments.

---

### Synchronous File I/O in Memory and Conversation Stores

**Issue:** Both `MemoryStore` and `ConversationManager` use synchronous file operations (`readFileSync`, `writeFileSync`) for persistence.

**Files:**
- `src/core/memory.ts:184-228`
- `src/core/conversation.ts:59-72`

**Impact:** File writes block the main thread during agent operation, potentially causing UI freezing or timeout issues with large files.

**Fix approach:** Convert to async file operations using `fs/promises` and add proper error handling with async/await patterns.

---

### Global Singleton Pattern for MCP Manager

**Issue:** The MCP manager uses a global singleton pattern (`_globalMcpManager`) which makes testing difficult and creates implicit dependencies.

**Files:** `src/mcp/manager.ts:8-16`

**Impact:** Tests may pollute each other through shared state; component isolation is compromised.

**Fix approach:** Pass MCP manager as a dependency through constructor/injection rather than relying on global state.

---

### Missing Graceful Shutdown Handler

**Issue:** The `Agent` class and `ConversationManager` lack proper shutdown/cleanup methods to handle process termination signals.

**Files:**
- `src/core/agent.ts`
- `src/core/conversation.ts:74-77`

**Impact:** Unsaved conversation history or memory data may be lost on unexpected process termination.

**Fix approach:** Implement `shutdown()` or `close()` methods that flush pending writes and disconnect MCP clients.

---

### Empty Promise Return in ConversationManager.close()

**Issue:** `ConversationManager.close()` is a no-op with a comment indicating simplified implementation without locks.

**File:** `src/core/conversation.ts:74-77`

```typescript
async close(): Promise<void> {
  // No-op: simplified implementation without locks
}
```

**Impact:** No cleanup or file synchronization occurs when closing conversation manager.

**Fix approach:** Implement proper resource cleanup or remove the method if truly unused.

---

## Security Considerations

### Dynamic Module Import in Plugin Loader

**Issue:** The plugin loader uses `import()` with `file://` protocol to load plugins, which can execute arbitrary JavaScript code.

**Files:** `src/tools/plugin-loader.ts:19`

```typescript
const module = (await import(`file://${filePath}`)) as PluginModule;
```

**Impact:** Users who install malicious plugins could have arbitrary code executed with the agent's permissions.

**Current mitigation:** Plugins are loaded from user config directory (`~/.tiny-agent/plugins/`), but there's no code signing or verification.

**Recommendations:**
- Add plugin signature verification
- Provide opt-in confirmation before loading plugins
- Document security implications for users

---

### Bash Tool Environment Variable Filtering

**Issue:** The bash tool filters sensitive environment variables using a pattern-based approach, but patterns may miss new or unusual secret naming conventions.

**Files:** `src/tools/bash-tool.ts:74-102`

**Impact:** Sensitive credentials could leak through environment variables with non-standard names.

**Fix approach:** Use an explicit allowlist approach rather than blocklist for environment variables.

---

### Regex-Based HTML Parsing in Web Search

**Issue:** The web search tool parses DuckDuckGo HTML results using complex regex patterns, which are fragile and may break with site changes.

**Files:** `src/tools/web-search-tool.ts:135-172`

**Impact:** Web search tool may stop working if DuckDuckGo changes their HTML structure.

**Fix approach:** Use a proper HTML parser library like `cheerio` or `jsdom` for more robust parsing.

---

### No Input Sanitization for File Paths in Edit Tool

**Issue:** The `edit_file` tool does not validate that `old_str` and `new_str` don't contain path traversal patterns.

**Files:** `src/tools/file-tools.ts:234-297`

**Impact:** While the tool doesn't write arbitrary file content, a malicious actor controlling the LLM could craft edits that modify unexpected files through carefully constructed old_str patterns.

**Current mitigation:** Path validation exists for `write_file` but not for `edit_file`.

---

## Performance Bottlenecks

### Deep Recursion in File Search Tools

**Issue:** Both `grep` and `glob` tools use recursive directory traversal without tail-call optimization, which could cause stack overflow on deeply nested directory structures.

**Files:**
- `src/tools/search-tools.ts:84-134` (searchFiles)
- `src/tools/search-tools.ts:231-276` (globFiles)

**Impact:** Process crash when traversing directories with extremely deep nesting (thousands of levels).

**Fix approach:** Convert recursive functions to iterative implementations using explicit stacks.

---

### No Backpressure Handling in LLM Streaming

**Issue:** The streaming implementations in providers don't implement backpressure handling, potentially causing memory issues with high-throughput streams.

**Files:**
- `src/providers/anthropic.ts:176-248`
- `src/providers/ollama.ts:121-238`

**Impact:** Memory exhaustion when receiving very large streaming responses.

**Fix approach:** Implement pull-based streaming where consumers control the rate of consumption.

---

### No Caching for Expensive Operations

**Issue:** Several operations that could benefit from caching are computed repeatedly:
- Model capabilities (`getCapabilities` is called frequently)
- Gitignore patterns (parsed on every file access)
- Token encoding (encoder is loaded per-call in some paths)

**Files:**
- `src/providers/anthropic.ts:250-272`
- `src/tools/file-tools.ts:156`
- `src/core/tokens.ts:7-18`

**Impact:** Unnecessary CPU usage and slower response times.

**Fix approach:** Add memoization/caching for:
- Model capabilities (cache by model name)
- Gitignore patterns (cache by directory path)
- Ensure single encoder instance is reused

---

### Memory Store Debounce Limits

**Issue:** The memory store uses a 100ms debounce for saves, which may not be aggressive enough for frequent updates or may cause data loss on crash.

**Files:** `src/core/memory.ts:4`

```typescript
const SAVE_DEBOUNCE_MS = 100;
```

**Impact:** Up to 100ms of memory data could be lost on sudden process termination.

**Fix approach:** Add periodic flush at longer intervals (e.g., 5 seconds) as a safety net.

---

## Fragile Areas

### Hardcoded Model Context Windows

**Issue:** Model context windows are hardcoded for Anthropic models, and will become outdated as new models are released.

**Files:** `src/providers/anthropic.ts:251-257`

```typescript
const modelContextWindow: Record<string, number> = {
  "claude-3-5-sonnet-20241022": 200000,
  // ... limited set of models
};
```

**Impact:** New Anthropic models will default to 200k context window, which may be incorrect.

**Fix approach:** Fetch model capabilities from provider API at runtime, or maintain external model registry.

---

### MCP Server Silent Failures

**Issue:** When MCP servers fail to connect, errors are silently logged with verbose warnings only.

**Files:** `src/mcp/manager.ts:62-66`

```typescript
} catch {
  if (this._verbose) {
    console.warn(`[MCP] ${name}: will connect on first tool use`);
  }
}
```

**Impact:** Users may not realize MCP tools are unavailable until they try to use them.

**Fix approach:** Return connection status to caller or surface errors through status API.

---

### Silent Error Swallowing in Skill Parsing

**Issue:** Errors in skill frontmatter parsing are caught and logged as warnings, but parsing failures may go unnoticed.

**Files:**
- `src/skills/loader.ts:47-50`
- `src/core/agent.ts:661-663`

```typescript
} catch {
  console.warn(`[WARN] Could not parse frontmatter for skill: ${skillName}`);
}
```

**Impact:** Skills with invalid frontmatter may be loaded with default permissions (all tools), creating security implications.

**Fix approach:** Fail fast on parse errors or mark skills as invalid with restricted permissions.

---

### DuckDuckGo HTML Structure Dependency

**Issue:** The web search tool relies on specific CSS class names from DuckDuckGo's HTML output.

**Files:** `src/tools/web-search-tool.ts:138-139`

```typescript
const resultPattern =
  /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>...
```

**Impact:** Any change to DuckDuckGo's HTML structure will break web search functionality.

**Fix approach:** Consider using an official search API (e.g., DuckDuckGo Instant Answer API) or fallback to alternative search providers.

---

## Scaling Limits

### Conversation History Memory Growth

**Issue:** Conversation history is stored in memory without limit (only token-based truncation).

**Files:** `src/core/conversation.ts`

**Impact:** Long-running sessions may consume significant memory as history grows.

**Fix approach:** Implement LRU-style eviction for conversation messages or periodic summarization.

---

### Memory Store Fixed Max Count

**Issue:** Memory store uses fixed max count (default 100 memories) rather than token-based limit.

**Files:** `src/core/memory.ts:45`

```typescript
this._maxMemories = options.maxMemories ?? 100;
```

**Impact:** Large memories may exceed token budgets while small memories leave unused capacity.

**Fix approach:** Support token-based limits similar to conversation truncation.

---

## Dependencies at Risk

### tiktoken Optional Dependency

**Issue:** `tiktoken` is a required dependency for accurate token counting but may fail to load in some environments (missing native modules).

**Files:** `src/core/tokens.ts:10-17`

**Impact:** Falls back to inaccurate character-based counting when tiktoken unavailable.

**Mitigation:** Fallback exists, but users should be warned when using inaccurate counting.

---

### DuckDuckGo Web Scraping

**Issue:** Web search tool scrapes DuckDuckGo HTML instead of using an official API.

**Impact:** Could break at any time due to:
- CSS class name changes
- Anti-bot measures
- HTML structure changes
- Rate limiting

**Fix approach:** Migrate to official search APIs (Bing Search API, Google Custom Search, etc.).

---

### Anthropic SDK Version Pinning

**Issue:** Uses `@anthropic-ai/sdk` which may have breaking changes in minor versions.

**Files:** `package.json:24`

**Current pinning:** `^0.71.2`

**Impact:** Upgrades may break compatibility without warning.

**Fix approach:** Pin to exact version and review changes before upgrading.

---

## Test Coverage Gaps

### No Integration Tests for Provider Layer

**Issue:** Provider tests use mocked responses; no live API tests.

**Files:**
- `test/providers/anthropic.test.ts`
- `test/providers/ollama.test.ts`

**Impact:** Real API issues may not be caught until production.

**Priority:** Medium

---

### No E2E Tests

**Issue:** No end-to-end tests that verify the full agent loop with real LLM calls.

**Files:** Missing `test/e2e/` directory

**Impact:** Integration issues between components may go undetected.

**Priority:** High

---

### Limited MCP Testing

**Issue:** MCP manager tests don't test server failures, reconnection logic, or tool conflicts.

**Files:** `test/mcp/manager.test.ts`

**Impact:** MCP-related edge cases may cause unexpected behavior.

**Priority:** Medium

---

### Missing Security Tests

**Issue:** No tests for:
- Path traversal attacks
- Command injection prevention
- Environment variable filtering
- Sensitive file access

**Files:** `test/security/` exists but limited scope

**Priority:** High

---

### No Performance Tests

**Issue:** No benchmarks or performance tests for:
- Token counting accuracy
- Search tool performance
- Memory store operations
- Provider streaming

**Priority:** Low

---

## Missing Critical Features

### Conversation Persistence Without Filename Conflict Resolution

**Issue:** If two agents write to the same conversation file simultaneously, data corruption may occur.

**Files:** `src/core/conversation.ts:59-72`

**Impact:** Concurrent agent runs sharing conversation file lose data.

**Fix approach:** Add file locking or use unique filenames per session.

---

### No Health Check / Readiness Probes

**Issue:** No way to determine if the agent is ready to accept requests (providers connected, config loaded, etc.).

**Impact:** Orchestrators can't determine agent health.

**Fix approach:** Add health check endpoint or method.

---

### Missing Rate Limit Handling

**Issue:** LLM providers don't implement rate limit handling or retry with backoff.

**Files:**
- `src/providers/anthropic.ts`
- `src/providers/ollama.ts`
- `src/providers/openai.ts`

**Impact:** API rate limits cause immediate failures rather than graceful retries.

**Fix approach:** Implement retry logic with exponential backoff for rate limit errors.

---

## Summary

| Category | High Priority | Medium Priority | Low Priority |
|----------|---------------|-----------------|--------------|
| Tech Debt | Synchronous I/O | Global singletons | Token fallback |
| Security | Plugin loader code exec | Env var filtering | HTML parsing |
| Performance | No backpressure | No caching | Debounce tuning |
| Fragile | Model context windows | MCP silent failures | DuckDuckGo dependency |
| Testing | No E2E tests | Limited MCP tests | No performance tests |

---

*Concerns audit: 2026-01-25*
