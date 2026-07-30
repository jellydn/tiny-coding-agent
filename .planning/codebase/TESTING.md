# Testing

## Framework
- **Test runner:** Bun's built-in test runner (`bun test`)
- **Assertion library:** `bun:test` — `expect`, `describe`, `it`
- **Type checking:** `tsc --noEmit` (pre-existing `@types/bun` issue)
- **Linting + formatting:** `biome check`

## Running Tests
```bash
bun test                       # All tests
bun test <file>                # Single file
bun test <pattern>             # Match pattern (e.g. "memory")
bun test:watch                 # Watch mode
```

## Test Structure
- **Test files:** `test/` directory mirrors `src/` structure
  - `test/core/` — Agent, memory, conversation, tokens
  - `test/agents/` — Plan, build, explore agents
  - `test/tools/` — File, bash, search, registry
  - `test/providers/` — Provider implementations
  - `test/cli/` — CLI handlers, main entry
  - `test/ui/` — UI utilities
  - `test/security/` — Security suite (path traversal, injection)
  - `test/config/` — Config loader
  - `test/observability/` — Telemetry, cost, tracing
  - `test/skills/` — Skill loading, parsing
- **Test count:** ~666 tests across ~80 files
- **Current results:** ~600 pass, ~66 fail (pre-existing environment-dependent failures)

## Test Patterns
- **Pure function tests**: Test input/output without mocks
- **Class tests**: Construct with test doubles, verify state transitions
- **Async tests**: Use `await` with `async` test functions
- **Cleanup**: `beforeEach`/`afterEach` for file system state

## Coverage Areas
| Area | Test coverage |
|------|---------------|
| Core agent loop | Good — streaming, iterations, tool execution |
| Memory store | Good — CRUD, eviction, persistence, signal handlers |
| Plan grammar | Good — parse, serialize, validate, edge cases |
| Tools (registry, file, bash) | Good — registration, execution, confirmation |
| CLI handlers | Good — config, state, memory, plan, trace, hooks |
| Providers | Good — OpenAI, Anthropic, Ollama, model registry |
| Security | Good — path traversal, injection, env vars, sensitive files |
| Observability | Good — telemetry, cost, token usage, Langfuse |
| Skills | Good — loading, parsing, frontmatter, built-in registry |
| UI utilities | Moderate — format, filter utilities |
| Chat UI (Ink) | Low — mostly rendering, tested via typecheck |

## Pre-existing Failures
The ~66 failing tests are environment-dependent and include:
- Path traversal security tests (sandbox permissions)
- Command injection prevention (shell environment)
- Sensitive file access (system config)
- Env variable filtering (shell environment)
- Config loader env var override loop (env vars)
- extractRecommendations (test fixture)
- ExploreAgentOptions (option parsing)
