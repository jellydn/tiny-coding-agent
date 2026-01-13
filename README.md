# Tiny Coding Agent

<p align="center">
  <img src="docs/logo.svg" alt="Tiny Coding Agent Logo" width="120" height="120">
</p>

A lightweight, extensible coding agent built in TypeScript that helps developers with coding tasks across TypeScript, React, JavaScript, Node.js, Bash, and markdown/JSON.

## Features

- **Multi-Provider LLM Support**: Works with OpenAI, Anthropic, and local Ollama models
- **MCP Client Integration**: Connect to Model Context Protocol servers for extended capabilities
- **Built-in Tools**: File operations, bash execution, grep, glob, and web search
- **Plugin System**: Extend the agent with custom tools
- **CLI-First Design**: Simple commands for chat, run, and config

## Quick Start

```bash
# Install dependencies
bun install

# Run the agent
bun run index.ts
```

## Configuration

A default config is automatically created on first run with:

- **Local LLM**: Ollama with llama3.2 model
- **Context7 MCP**: Up-to-date library documentation (no API key needed)
- **All Tools**: Enabled by default (can be disabled in config)

To customize, create `~/.tiny-agent/config.yaml`:

```yaml
defaultModel: gpt-4o
providers:
  openai:
    apiKey: ${OPENAI_API_KEY}
  anthropic:
    apiKey: ${ANTHROPIC_API_KEY}
  ollama:
    baseUrl: http://localhost:11434
mcpServers:
  context7:
    command: npx
    args: ["-y", "@upstash/context7-mcp"]
tools:
  read_file:
    enabled: true
  bash:
    enabled: true
  web_search:
    enabled: false # Disable specific tools
```

## CLI Commands

- `tiny-agent chat` - Start interactive chat session
- `tiny-agent run "prompt"` - Run single prompt and exit
- `tiny-agent config` - Show current configuration
- `tiny-agent status` - Show current status (LLM provider, MCP servers, tools)

## Project Structure

```
src/
  core/       # Agent loop, context management
  tools/      # Built-in tools
  providers/  # LLM provider implementations
  mcp/        # MCP client integration
  cli/        # Command-line interface
  config/     # Configuration loading
```

## Architecture

See [docs/adr/](docs/adr/) for architectural decisions:

- 001: Project Architecture
- 002: LLM Provider Abstraction
- 003: MCP Client Implementation
- 004: Context Management (Handoff)
- 005: Tool System Design
- 006: Plugin System

## License

MIT
