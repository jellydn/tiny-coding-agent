# Tiny Coding Agent

<p align="center">
  <img src="docs/logo.svg" alt="Tiny Coding Agent Logo" width="120" height="120">
  <br>
  <a href="https://agents.md/"><img src="https://img.shields.io/badge/AGENTS.md-supported-green" alt="AGENTS.md supported"></a>
</p>

A lightweight, extensible coding agent built in TypeScript that helps developers with coding tasks across TypeScript, React, JavaScript, Node.js, Bash, and markdown/JSON.

## Features

- **Rich Terminal UI**: Ink-powered CLI with components for messages, spinners, and tool output
- **TTY Detection**: Automatically adapts to terminal capabilities with plain text fallback
- **Multi-Provider LLM Support**: Works with OpenAI, Anthropic, Ollama, OpenRouter, and OpenCode
- **MCP Client Integration**: Connect to Model Context Protocol servers for extended capabilities
- **Built-in Tools**: File operations, bash execution, grep, glob, and web search
- **Memory System**: User-initiated persistent storage with relevance-based retrieval
- **Agent Skills**: Reusable prompts from agentskills.io or custom SKILL.md files
- **Plugin System**: Extend the agent with custom tools
- **JSON Output Mode**: Machine-readable output for tooling integration

## Quick Install

### One-line Install (macOS/Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/jellydn/tiny-coding-agent/main/scripts/install.sh | sh
```

This downloads the latest release binary for your platform and installs it to `~/.local/bin/`.

**Safer alternative** (inspect before running):

```bash
curl -fsSL -o install.sh https://raw.githubusercontent.com/jellydn/tiny-coding-agent/main/scripts/install.sh
less install.sh  # inspect the script
sh install.sh
```

**Note:** After installation, add `~/.local/bin` to your PATH if not already present.

### Homebrew (macOS)

```bash
brew install jellydn/tap/tiny-agent
```

### Build from Source

```bash
git clone https://github.com/jellydn/tiny-coding-agent.git
cd tiny-coding-agent
bun install
bun run build
./tiny-agent --help
```

### System Requirements

| Requirement  | Minimum Version |
| ------------ | --------------- |
| macOS        | 11.0 (Big Sur)  |
| Linux        | glibc 2.28+     |
| Architecture | x64 or arm64    |

## Troubleshooting

### "command not found: tiny-agent"

The binary is not in your PATH. Add it:

```bash
# For bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc && source ~/.bashrc

# For zsh
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

### API key errors

Set your API key as an environment variable:

```bash
export OPENAI_API_KEY="your-key"
export ANTHROPIC_API_KEY="your-key"
export OLLAMA_API_KEY="your-key"
```

Or configure in `~/.tiny-agent/config.yaml`:

```yaml
providers:
  openai:
    apiKey: ${OPENAI_API_KEY}
```

## Uninstallation

To remove the installed binary:

```bash
rm ~/.local/bin/tiny-agent
```

Or if installed via Homebrew:

```bash
brew uninstall tiny-agent
brew untap jellydn/tap
```

## Configuration

A default config is automatically created on first run with:

- **Local LLM**: Ollama with llama3.2 model
- **Context7 MCP**: Up-to-date library documentation (no API key needed)
- **All Tools**: Enabled by default (can be disabled in config)

To customize, create `~/.tiny-agent/config.yaml`:

### Full Configuration Example

```yaml
# Default model to use
defaultModel: qwen2.5-coder:7b

# System prompt (optional, overrides default)
systemPrompt: "You are a helpful coding assistant."

# Provider configurations
providers:
  # OpenAI (GPT models)
  openai:
    apiKey: ${OPENAI_API_KEY}
    baseUrl: https://api.openai.com/v1 # Optional: custom base URL

  # Anthropic (Claude models)
  anthropic:
    apiKey: ${ANTHROPIC_API_KEY}

  # Ollama (local or cloud)
  ollama:
    baseUrl: http://localhost:11434 # Local Ollama
    # For Ollama Cloud, use:
    # baseUrl: https://ollama.com
    # apiKey: ${OLLAMA_API_KEY}

  # OpenRouter
  openrouter:
    apiKey: ${OPENROUTER_API_KEY}

  # OpenCode
  opencode:
    apiKey: ${OPENCODE_API_KEY}

# MCP servers for extended capabilities (opt-in - only configured servers are enabled)
mcpServers:
  # Context7: Documentation lookups for libraries/frameworks
  context7:
    command: npx
    args: ["-y", "@upstash/context7-mcp"]

  # Serena: Semantic code operations (optional, requires uv)
  # Install uv first: curl -LsSf https://astral.sh/uv/install.sh | sh
  # serena:
  #   command: uvx
  #   args:
  #     [
  #       "--from",
  #       "git+https://github.com/oraios/serena",
  #       "serena-mcp-server",
  #       "--context",
  #       "ide",
  #       "--project",
  #       ".",
  #       "--open-web-dashboard",
  #       "false",
  #     ]

# Disable specific MCP tools by pattern (glob-style matching)
# disabledMcpPatterns:
#   - "mcp_serena_*memories*"    # Disable Serena memory tools
#   - "mcp_serena_*onboarding*"  # Disable Serena onboarding tools

# Disable all MCP servers
# mcpServers: {}

# Or use CLI to manage MCP servers:
# tiny-agent mcp list              # List available servers
# tiny-agent mcp enable context7   # Enable context7
# tiny-agent mcp disable serena    # Disable serena

# Tool configurations
tools:
  read_file:
    enabled: true
  write_file:
    enabled: true
  edit_file:
    enabled: true
  list_directory:
    enabled: true
  bash:
    enabled: true
  grep:
    enabled: true
  glob:
    enabled: true
  web_search:
    enabled: false

# Memory settings (optional)
memoryFile: ~/.tiny-agent/memories.json
maxMemoryTokens: 2000

# Context tracking (optional)
maxContextTokens: 16000
trackContextUsage: true
```

### Ollama Cloud Setup

For access to larger cloud-hosted models via [Ollama Cloud](https://ollama.com/cloud):

Get your API key and export it as an environment variable:

```bash
export OLLAMA_API_KEY="your-api-key"
```

**Config:**

```yaml
defaultModel: gpt-oss:120b
providers:
  ollama:
    baseUrl: https://ollama.com
    apiKey: ${OLLAMA_API_KEY}
```

### OpenCode Zen

[OpenCode Zen](https://opencode.ai/zen) provides curated, tested models for coding agents.

```bash
# Get API key from https://opencode.ai/auth
export OPENCODE_API_KEY="your-api-key"
```

**Config:**

```yaml
providers:
  opencode:
    apiKey: ${OPENCODE_API_KEY}
```

**Available models:**

- `big-pickle` - OpenCode's flagship coding model
- `claude-opus-4`, `claude-sonnet-4`, `claude-3-5-haiku`
- `gpt-5.2`, `gpt-5.1`, `gpt-5`, `gpt-5-nano`
- `qwen3-coder` - Qwen Coder
- `kimi-k2`, `kimi-k2-thinking` - Kimi models

**Usage:**

```bash
tiny-agent --provider opencode --model big-pickle "fix this bug"
tiny-agent --provider opencode --model qwen3-coder "write a function"
```

## CLI Commands

| Command                   | Description               |
| ------------------------- | ------------------------- |
| `tiny-agent chat`         | Interactive chat session  |
| `tiny-agent run "prompt"` | Single prompt, then exit  |
| `tiny-agent config`       | Show current config       |
| `tiny-agent status`       | Show provider, MCP, tools |
| `tiny-agent mcp`          | Manage MCP servers        |
| `tiny-agent memory`       | Manage memories           |
| `tiny-agent skill`        | Manage skills             |

### MCP Server Management

```
tiny-agent mcp list              # List available MCP servers
tiny-agent mcp enable <name>     # Enable a default MCP server
tiny-agent mcp disable <name>    # Disable an MCP server
tiny-agent mcp add <name> <cmd>  # Add a custom MCP server
```

**Default MCP Servers:**

- **context7**: Documentation lookup via `@upstash/context7-mcp`
- **serena**: Semantic code operations (requires `uv`)

**Examples:**

```bash
# Enable serena (opt-in, requires uv)
tiny-agent mcp enable serena

# Disable serena
tiny-agent mcp disable serena

# Add a custom MCP server
tiny-agent mcp add myserver npx -y @org/mcp-server
```

### Options

| Option              | Description                                             |
| ------------------- | ------------------------------------------------------- |
| `--model <name>`    | Override default model                                  |
| `--provider <name>` | Override provider (openai\|anthropic\|ollama\|opencode) |
| `--json`            | Output in JSON format (for programmatic consumption)    |
| `--verbose, -v`     | Enable verbose logging                                  |
| `--save`            | Save conversation to file                               |
| `--no-memory`       | Disable memory                                          |
| `--allow-all, -y`   | Auto-approve all tool confirmations                     |

### Tool Confirmation

Dangerous tools require confirmation before execution:

- **Destructive**: `write_file`, `edit_file`, `bash` (git commit, rm, redirection)
- **Sensitive files**: `read_file` (.env, SSH keys, credentials)
- **External**: MCP tools

**Smart Detection**: Safe bash commands like `git status`, `ls`, `cat`, `npm test` skip confirmation.

**Interactive Prompt**:

```
⚠️  The following operations will be performed:
  [1] write_file: Will create or overwrite file
      (path="example.ts")
  [2] bash: Destructive command: rm file.txt

Approve all? (y/N), or enter number to approve individually:
```

**Bypass Confirmations**: Use `--allow-all` or `-y` flag for automation/CI.

## Agent Skills

Tiny-agent supports **Agent Skills** - reusable prompt templates that can be loaded and used during conversations. Skills are defined in `SKILL.md` files with YAML frontmatter.

### Built-in Skills

The agent includes several built-in skills for common tasks. Type `@` to see available skills, or use `/skill` to list them.

### Custom Skills Directory

Add your own skills by creating `SKILL.md` files in skill directories:

```yaml
# ~/.tiny-agent/skills/my-custom-skill/SKILL.md
---
name: my-custom-skill
description: A custom skill for XYZ tasks
allowedTools:
  - read_file
  - edit_file
  - write_file
---

You are an expert at XYZ. When given a task:
1. First analyze the codebase to understand the structure
2. Then implement the requested changes
3. Finally verify your changes work correctly
```

Enable custom skills directories in config:

```yaml
skillDirectories:
  - ~/.tiny-agent/skills/ # Global: available in all projects
  - .skills/ # Project-local: .skills/ directory in your project
```

### Skill Format

Each skill must have a `SKILL.md` file with:

```yaml
---
name: skill-name
description: Brief description of what the skill does
allowedTools: # Optional: restrict which tools can be used
  - read_file
  - write_file
license: MIT # Optional
---
# Skill content (Markdown)
Your skill prompt here...
```

The skill content is loaded as a system prompt modification when the skill is activated.

### Loading Skills

The agent supports skills from multiple sources:

- **[vercel/agent-skills](https://github.com/vercel-labs/agent-skills)**: Community-contributed skills (limited selection)

  ```bash
  git clone https://github.com/vercel-labs/agent-skills.git ~/.tiny-agent/skills/vercel-agent-skills
  ```

- **[skills.sh](https://skills.sh/)**: Browse and download individual skills from a larger registry

Skills are automatically discovered from `SKILL.md` files in your configured skill directories.

### Chat Commands

| Command         | Description                               |
| --------------- | ----------------------------------------- |
| `/help`         | Show available commands                   |
| `/clear`        | Clear conversation history                |
| `/model <name>` | Switch model                              |
| `/tools`        | View tool execution history               |
| `/mcp`          | Show MCP server status                    |
| `/memory`       | List stored memories                      |
| `/skill [name]` | List all skills, or load a specific skill |
| `@<skill-name>` | Load a skill (type @ to see picker)       |
| `/exit`         | Exit chat (Ctrl+D also works)             |

## Custom Plugins

Add tools via `~/.tiny-agent/plugins/<name>.js`:

```javascript
export default {
  name: "my_tool",
  description: "What this tool does",
  parameters: {
    type: "object",
    properties: { input: { type: "string" } },
    required: ["input"],
  },
  async execute({ input }) {
    return { success: true, output: "result" };
  },
};
```

Enable in config:

```yaml
tools:
  my_tool: { enabled: true }
```

## Project Structure

```
src/
  core/       # Agent loop, memory, context
  tools/      # Built-in tools
  providers/  # LLM clients (OpenAI, Anthropic, Ollama)
  mcp/        # MCP client
  cli/        # CLI interface
  ui/         # Ink UI components (App, Message, Spinner, ToolOutput)
```

## Architecture

See [docs/adr/](docs/adr/) for architectural decisions:

- 001: Project Architecture
- 002: LLM Provider Abstraction
- 003: MCP Client Implementation
- 004: Context Management (Handoff)
- 005: Tool System Design
- 006: Plugin System
- 007: Model Registry Pattern
- 008: Memory System
- 009: Tool Confirmation System
- 010: Ink CLI Integration

## Development

This project follows the [AGENTS.md](https://agents.md/) standard for guiding coding agents. See [AGENTS.md](AGENTS.md) for:

- Build commands: `bun run dev`, `bun run build`, `bun test`
- TypeScript conventions and code style
- Testing patterns with bun:test

### Using Make or Just

For easier development, you can use either **Make** (traditional) or **Just** (modern alternative):

**Using Make** (pre-installed on most Unix systems):
```bash
make help          # Show all available targets
make dev           # Run in watch mode
make build         # Build the binary
make test          # Run tests
make check         # Quick check (lint + typecheck)
```

**Using Just** (install with `cargo install just` or `brew install just`):
```bash
just               # List all available recipes
just dev           # Run in watch mode
just build         # Build the binary
just test          # Run tests
just check         # Quick check (lint + typecheck)
```

Both provide the same functionality - choose whichever you prefer!

## License

MIT
