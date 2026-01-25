# Codebase Concerns

**Analysis Date:** 2026-01-25

## Large Files (Complexity Concerns)

**Large files indicate high complexity and should be refactored:**

### `src/cli/main.tsx` (1365 lines)

- **Issue**: Very large CLI entry point with multiple responsibilities
- **Files**: `src/cli/main.tsx`
- **Impact**: Difficult to test, maintain, and understand
- **Fix approach**: Split into smaller components by feature (chat handling, command parsing, rendering logic)

### `src/core/agent.ts` (848 lines)

- **Issue**: Agent class has too many responsibilities (provider management, tool execution, conversation handling, memory, skills)
- **Files**: `src/core/agent.ts`
- **Impact**: Violates Single Responsibility Principle; hard to extend or modify
- **Fix approach**: Extract provider management to separate class, move skill loading to dedicated service

### `src/core/memory.ts` (409 lines)

- **Issue**: Memory store handles persistence, token counting, eviction, and context building
- **Files**: `src/core/memory.ts`
- **Impact**: Tight coupling between storage logic and context building
- **Fix approach**: Separate persistence layer from memory management logic

### `src/tools/file-tools.ts` (375 lines)

- **Issue**: Large file with many file operation tools
- **Files**: `src/tools/file-tools.ts`
- **Impact**: Hard to locate specific tool implementations
- **Fix approach**: Split into dedicated files by operation type (read, write, glob, grep)

## Deprecated Global Patterns

**MCP Manager uses deprecated global singleton pattern:**

### Global MCP Manager

- **Issue**: `src/mcp/manager.ts` exports deprecated global manager functions
- **Files**: `src/mcp/manager.ts`
- **Impact**: Creates implicit dependencies; makes testing harder; will be removed in future version
- **Current usage**: `src/core/agent.ts` imports and uses `getGlobalMcpManager()`
- **Fix approach**: Inject `McpManager` instance via constructor or method parameters

## Security Considerations

### Shell Command Execution

- **Risk**: `bash-tool.ts` uses `shell: true` in `spawn()` for command execution
- **Files**: `src/tools/bash-tool.ts`
- **Current mitigation**:
  - Destructive command detection with regex patterns
  - Read-only command allowlist
  - Safe environment variable filtering (only allowlisted env vars passed)
- **Remaining risk**: Shell injection via crafted input is possible if validation is bypassed
- **Recommendations**: Consider using array-based spawn without shell when possible

### Environment Variable Interpolation

- **Risk**: Config loader interpolates `${VAR}` patterns from config files
- **Files**: `src/config/loader.ts`
- **Current mitigation**: Throws error if referenced env var is not set
- **Concern**: API keys in config could be logged or exposed in error messages
- **Fix approach**: Avoid putting sensitive values in config files; use env vars only at runtime

### Memory File Persistence

- **Risk**: Memory store writes to file without encryption
- **Files**: `src/core/memory.ts`
- **Concern**: Stored memories may contain sensitive information
- **Current mitigation**: Memory file is in user home directory with default permissions
- **Fix approach**: Add option for encrypted memory storage for sensitive workloads

## Error Handling Gaps

### Silent Error Catching in Memory Store

- **Issue**: Memory loading failures are logged but continue execution
- **Files**: `src/core/memory.ts` (lines 63-66, 257-259)
- **Impact**: Agent continues without memory, may produce unexpected results
- **Current behavior**: Console error logged, agent proceeds
- **Fix approach**: Consider making memory failures more visible or provide fallback

### Provider Creation Failures

- **Issue**: Provider creation failures fall back to default client silently
- **Files**: `src/core/agent.ts` (lines 296-299)
- **Impact**: Wrong provider may be used without clear indication
- **Current behavior**: Verbose mode logs error, falls back to default
- **Fix approach**: Add warning or make fallback behavior configurable

### Tool Result Parsing

- **Issue**: JSON parse failures in tool arguments result in empty object
- **Files**: `src/providers/openai.ts` (lines 80-87, 182-194)
- **Impact**: Invalid JSON in tool arguments silently becomes `{}`
- **Fix approach**: Log parsing failures or return error result

## Performance Concerns

### Memory Store Debouncing

- **Issue**: Memory saves are debounced with 100ms delay
- **Files**: `src/core/memory.ts`
- **Risk**: Unsaved memories may be lost on abrupt termination
- **Current behavior**: `flush()` called on `shutdown()` but not on unhandled errors
- **Fix approach**: Consider synchronous write for critical data or add signal handlers

### Provider Cache Size

- **Issue**: Provider cache limited to 10 entries
- **Files**: `src/core/agent.ts` (line 193)
- **Impact**: Cache eviction may cause unnecessary provider recreation
- **Fix approach**: Increase cache size or use LRU eviction

### Large Conversation History

- **Issue**: Full conversation history is kept in memory
- **Files**: `src/core/conversation.ts`
- **Impact**: Long-running sessions may consume significant memory
- **Current behavior**: History truncated only when context limit reached
- **Fix approach**: Consider periodic persistence of conversation history

## Dependency Risks

### API Version Pinning

- **Risk**: Multiple packages pinned to specific minor versions
- **Files**: `package.json`
- **Packages**:
  - `@anthropic-ai/sdk: ^0.71.2`
  - `@modelcontextprotocol/sdk: ^1.25.2`
  - `openai: ^6.16.0`
- **Impact**: Security patches may require version bumps; breaking changes possible on minor updates
- **Fix approach**: Keep dependencies updated regularly; monitor changelogs

### Outdated React Version

- **Risk**: Using React 19.2.3 which is very new
- **Files**: `package.json`
- **Impact**: May have compatibility issues with ink or other React-based tools
- **Current status**: Appears to work, but less battle-tested
- **Fix approach**: Test thoroughly; consider pinning to stable minor version

## Test Coverage Gaps

### CLI Integration Tests

- **What's not tested**: Full CLI workflow with real LLM providers
- **Files**: `src/cli/main.tsx`
- **Risk**: CLI regressions may not be caught
- **Priority**: Medium

### MCP Server Error Scenarios

- **What's not tested**: MCP server disconnects, timeouts, malformed responses
- **Files**: `src/mcp/manager.ts`, `src/mcp/client.ts`
- **Risk**: MCP failures may cause unexpected agent behavior
- **Priority**: Low (graceful degradation tested)

### Provider Fallback Behavior

- **What's not tested**: Automatic fallback when provider fails
- **Files**: `src/core/agent.ts`
- **Risk**: Fallback may not work as expected in production
- **Priority**: Medium

## Fragile Areas

### Conversation Manager File I/O

- **Why fragile**: Multiple async operations on same file without locking
- **Files**: `src/core/conversation.ts`
- **Safe modification**: Ensure operations are sequential; add file locking if needed

### Tool Registry Batch Execution

- **Why fragile**: Batch execution assumes all tools complete successfully
- **Files**: `src/tools/registry.ts`
- **Safe modification**: Add individual tool error handling

### Provider Factory

- **Why fragile**: Complex logic for provider detection and creation
- **Files**: `src/providers/factory.ts`
- **Safe modification**: Add integration tests for each provider type

## Known Limitations

### Context Window Handling

- **Problem**: Context budget allocation is hardcoded (20% for memory)
- **Files**: `src/core/memory.ts`
- **Blocks**: Users who want different memory/conversation balance
- **Fix approach**: Make memory budget percentage configurable

### Token Counting Accuracy

- **Problem**: `tiktoken` may not perfectly count all token types
- **Files**: `src/core/tokens.ts`
- **Impact**: Context limits may be exceeded or underutilized
- **Fix approach**: Consider using model's native token counting when available

### Multi-Provider Conversation

- **Problem**: Switching providers mid-conversation not well tested
- **Files**: `src/core/agent.ts`
- **Impact**: Provider switching may lose context or produce inconsistent results
- **Fix approach**: Document limitation or add provider affinity options

---

_Concerns audit: 2026-01-25_
