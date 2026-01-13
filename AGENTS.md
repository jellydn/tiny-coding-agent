# Tiny Coding Agent - Development Guide

## Overview

A lightweight, extensible coding agent built in TypeScript. Supports multiple LLM providers (OpenAI, Anthropic, Ollama), MCP client integration, and a plugin system for custom tools.

## Build Commands

```bash
# Run the agent
bun run index.ts

# Development mode with watch
bun run dev

# Compile to standalone binary
bun run build

# Type check (Tsc)
npx tsc --noEmit
bun run typecheck

# Linting with oxlint
bun run lint
bun run lint:fix      # Auto-fix issues

# Formatting with oxfmt
bun run format
bun run format:check  # Check without modifying

# Run tests (when implemented)
bun test
bun test --filter <pattern>    # Run single test file
```

## Code Style Guidelines

### TypeScript

- Use ES modules with TypeScript 5+
- Enable strict mode in tsconfig.json
- Use explicit types for function parameters and return types
- Prefer interfaces over type aliases for object shapes
- Use `satisfies` operator for type assertions when appropriate
- Use path aliases: `@/*` maps to `src/*`

### Imports

- Use path imports for internal modules: `import { Tool } from './tools/base.js'`
- Include `.js` extension for relative imports
- Group imports: external → internal → relative
- Avoid default exports for better refactoring support

### Naming Conventions

- **Files**: kebab-case for utilities, PascalCase for classes/components
- **Variables/functions**: camelCase
- **Constants**: SCREAMING_SNAKE_CASE
- **Classes/Interfaces**: PascalCase
- **Private members**: prefix with underscore `_client`

### String Quotes

- Use double quotes for all strings: `"text"` not `'text'`

### Error Handling

- Use structured error responses: `{ success: boolean; output?: string; error?: string }`
- Aggregate validation errors into arrays with field paths
- Never throw errors for expected failures in tool execution
- Log errors with context but continue execution where possible
- Use custom error types for specific failure modes

### Code Structure

- Keep functions small and single-purpose (ideally <50 lines)
- Use guard clauses to reduce nesting: check for errors early and return
- Extract complex conditions into well-named variables
- Separate pure logic from side effects
- Use type guards with type predicates for runtime type narrowing

### Tool Interface

All tools must implement:

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}
```

### Async Patterns

- Use async generators for streaming responses
- Use `for await...of` for iterating over async streams
- Buffer partial results when processing streaming data

### Project Structure

```
src/
  core/         # Agent loop, context management
  tools/        # Built-in tools (file, bash, grep, etc.)
  providers/    # LLM provider implementations
  mcp/          # MCP client integration
  cli/          # Command-line interface
  config/       # Configuration loading
```

### Configuration

- Load from `~/.tiny-agent/config.yaml` (fallback to `config.json`)
- Support environment variable overrides (e.g., `TINY_AGENT_MODEL`)
- Validate schema on load with helpful errors
- Support `${ENV_VAR}` interpolation in config values

### Key Dependencies

- `@anthropic-ai/sdk` for Claude
- `openai` for OpenAI-compatible APIs
- `yaml` for config parsing

### TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "paths": { "@/*": ["src/*"] }
  }
}
```
