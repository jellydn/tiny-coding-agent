# ADR-001: Project Architecture

**Status:** Accepted  
**Date:** 2026-01-13  
**Deciders:** huynhdung

## Context

Building a tiny coding agent that needs to be extensible, support multiple LLM providers, and integrate with MCP servers.

## Decision

### Technology Stack

- **Runtime:** Node.js 20+ with ES modules
- **Language:** TypeScript (strict mode)
- **Build:** tsup for fast bundling
- **Testing:** Vitest
- **CLI:** commander.js

### Project Structure

```
tiny-agent/
├── src/
│   ├── core/           # Agent loop, message handling
│   ├── providers/      # LLM provider implementations
│   ├── tools/          # Built-in tools
│   ├── mcp/            # MCP client implementation
│   ├── config/         # Configuration loading/validation
│   ├── cli/            # CLI commands
│   └── index.ts        # Main entry point
├── docs/
│   └── adr/            # Architecture Decision Records
├── tests/
└── package.json
```

## Consequences

**Positive:**

- TypeScript provides type safety and better DX
- ES modules enable tree-shaking and modern imports
- Minimal dependencies keep the agent "tiny"

**Negative:**

- ES modules can have compatibility issues with some npm packages
- TypeScript adds build step complexity
