# Tiny Coding Agent

<p align="center">
  <img src="docs/logo.svg" alt="Tiny Coding Agent Logo" width="120" height="120">
</p>

A lightweight, extensible coding agent built in TypeScript that helps developers with coding tasks across TypeScript, React, JavaScript, Node.js, Bash, and markdown/JSON.

## Features

- **Multi-Provider LLM Support**: Works with OpenAI, Anthropic, Ollama, OpenRouter, and OpenCode
- **MCP Client Integration**: Connect to Model Context Protocol servers for extended capabilities
- **Built-in Tools**: File operations, bash execution, grep, glob, and web search
- **Memory System**: User-initiated persistent storage with relevance-based retrieval
- **Plugin System**: Extend the agent with custom tools
- **CLI-First Design**: Simple commands for chat, run, and config

## Quick Install

### One-Liner (Linux & macOS)

```bash
curl -fsSL https://raw.githubusercontent.com/jellydn/tiny-coding-agent/main/scripts/install.sh | bash
```

This downloads the latest release binary for your platform and installs it to `~/.local/bin/`.

**Options:**

```bash
curl -fsSL https://raw.githubusercontent.com/jellydn/tiny-coding-agent/main/scripts/install.sh | bash -s -- -v v0.1.0  # specific version
curl -fsSL https://raw.githubusercontent.com/jellydn/tiny-coding-agent/main/scripts/install.sh | bash -s -- -d /usr/local/bin  # custom dir
curl -fsSL https://raw.githubusercontent.com/jellydn/tiny-coding-agent/main/scripts/install.sh | bash -s -- -f  # overwrite existing
```

**Note:** After installation, add `~/.local/bin` to your PATH if not already present.

### Homebrew (macOS)

```bash
brew tap jellydn/tiny-coding-agent
brew install tiny-agent
```

### From Source

```bash
git clone https://github.com/jellydn/tiny-coding-agent.git
cd tiny-agent
bun install
bun run build
./tiny-agent --help
```

### Binary Download

Download the latest release from [GitHub Releases](https://github.com/jellydn/tiny-coding-agent/releases):

| Platform | Architecture  | Binary                   |
| -------- | ------------- | ------------------------ |
| macOS    | Apple Silicon | `tiny-agent-macos-arm64` |
| macOS    | Intel         | `tiny-agent-macos-x64`   |
| Linux    | x64           | `tiny-agent-linux-x64`   |

Verify integrity:

```bash
sha256sum -c SHA256SUMS
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

### "Permission denied" during installation

The installation directory is not writable. Either:

- Use `sudo` with a system directory: `-d /usr/local/bin`
- Or ensure `~/.local/bin` exists and is writable

### "Unsupported OS" error

Currently supported:

- Linux (x64, arm64)
- macOS (Intel and Apple Silicon)

Windows is not yet supported. Use WSL2 on Windows.

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

### Model not found

Ensure your model is available for your provider. Run:

```bash
tiny-agent status
```

### Installation verification

To verify your installation:

```bash
tiny-agent --help
tiny-agent status
```

## Uninstallation

To remove the installed binary:

```bash
rm ~/.local/bin/tiny-agent
```

Or if installed via Homebrew:

```bash
brew uninstall tiny-agent
brew untap jellydn/tiny-coding-agent
```

## Configuration

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

# MCP servers for extended capabilities
mcpServers:
  context7:
    command: npx
    args: ["-y", "@upstash/context7-mcp"]

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

### Options

| Option              | Description                                             |
| ------------------- | ------------------------------------------------------- |
| `--model <name>`    | Override default model                                  |
| `--provider <name>` | Override provider (openai\|anthropic\|ollama\|opencode) |
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

### Chat Commands

| Command                     | Description                   |
| --------------------------- | ----------------------------- |
| `/model <name>`             | Switch model                  |
| `/thinking on\|off`         | Toggle thinking mode          |
| `/effort low\|medium\|high` | Set effort level              |
| `/bye`                      | Exit chat (Ctrl+D also works) |

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

## Development

See [AGENTS.md](AGENTS.md) for:

- Build commands: `bun run dev`, `bun run build`, `bun test`
- TypeScript conventions and code style
- Testing patterns with bun:test

## License

MIT
