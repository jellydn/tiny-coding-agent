# CONCERNS.md — Technical Debt & Issues

## Known Issues

### Pre-existing Test Failures (2)
- `handlePlanCommand > should show error when state file not found` — environment-dependent, fails when state file is unexpectedly readable
- `handleReviewCommand > should show error when config file cannot be read` — environment-dependent, fails when config file is unexpectedly readable

Both are CLI handler tests that depend on specific file system states. Not regressions from recent work.

### Large Files (>300 lines)

| File | Lines | Concern |
|------|-------|---------|
| `src/core/agent.ts` | 417 | Still the largest file after StreamProcessor extraction. Context setup + delegation + exports. |
| `src/core/stream-processor.ts` | 394 | Core iteration loop — complex but well-structured. |
| `src/core/memory.ts` | 347 | Memory persistence + SignalHandlerManager integration. |
| `src/cli/handlers/login-flow.ts` | 346 | Interactive login flow — many branches for provider selection. |
| `src/tools/search-tools.ts` | 329 | grep + glob tools — candidate for file-traversal extraction. |
| `src/tools/file-tools.ts` | 326 | File operations — complex validation + safety checks. |
| `src/core/agent-observability.ts` | 326 | Observability wrapper — many span types. |
| `src/skills/signature.ts` | 320 | Plugin signature verification — crypto operations. |
| `src/providers/ollama.ts` | 316 | Ollama provider — model listing + inference. |

## Tech Debt

### Extraction Opportunities (Round 10+)
1. **File Traversal** (`search-tools.ts` → `file-traversal.ts`) — Candidate #3
   - `searchFiles()` and `globFiles()` are general-purpose traversal utilities
   - Could be reused by `file-tools.ts` and `codebase-explorer.ts`
   - Speculative but high leverage if file-tools grows

### Import Hygiene
- Some files have unused imports that lint doesn't catch (e.g., `Message`, `ToolDefinition` in provider files after extraction)
- The `assistantToolCalls` type is duplicated inline in `stream-processor.ts` instead of importing `AssistantToolCall` from `turn-executor.ts`

### Type Safety
- `extractAnthropicUsage` casts `raw` to `Record<string, unknown>` — safe but could use a type guard
- `buildContextStats` closure in `agent.ts` captures mutable `messages` array — correct but fragile

## Performance Considerations

### Token Counting
- `countTokensSync` uses tiktoken encoder which is initialized lazily
- `freeTokenEncoder()` is available but not called automatically — encoder stays in memory

### MCP Tool Discovery
- Tool categorization heuristic (`inferRelevantCategories`) filters tools per-request
- Core tools (read_file, write_file, etc.) always included regardless of relevance
- MCP tools with categories are filtered by heuristic matching

### Memory Management
- Memory eviction is category-weighted (user > project > codebase)
- Token budget defaults to 30% of context window
- LRU eviction with sorted ID tracking

## Security

### Tool Confirmation
- Dangerous commands (rm, git push, etc.) require user confirmation
- `isDestructiveCommand()` in bash-tool checks command patterns
- `isSensitiveFile()` in file-utils checks for .env, secrets, etc.

### API Key Handling
- Keys stored in config YAML (not encrypted)
- `redactApiKey()` masks keys in logs
- `containsLiteralApiKey()` checks for literal key values in config

### Command Injection
- Bash tool uses `spawn` with shell: false where possible
- `validatePath()` prevents directory traversal
- `findGitignorePatterns()` respects .gitignore rules

## Testing Gaps

### Low Coverage Areas
- `stream-processor.ts` — no dedicated unit tests (tested via agent integration tests)
- `anthropic-converters.ts` — no dedicated unit tests (tested via provider tests)
- `context-budget-calc.ts` — tested via context-budget.test.ts
- `memory-eviction.ts` — tested via memory.test.ts

### Integration Test Coverage
- `test/e2e/agent-loop.test.ts` — end-to-end agent loop test
- `test/core/agent.test.ts` — agent unit tests with mocked LLM
- Provider tests mock HTTP responses but don't test real API calls

## Fragile Areas

### Agent Loop Termination
- Loop detection uses heuristic thresholds (3 identical calls, 5 same tool, 8 dominant tool)
- Max iterations default is 20 — configurable but not validated
- Abort signal propagation depends on all layers checking `checkAborted()`

### Conversation History
- History is loaded from file on first `runStream()` call
- History is saved after each `runStream()` completion
- If agent crashes mid-loop, history may be inconsistent

### Provider Failures
- Provider cache silently falls back to default client
- No retry logic for provider failures (only for tool execution)
- Rate limiting not handled at provider level
