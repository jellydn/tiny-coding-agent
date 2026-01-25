# External Integrations

**Analysis Date:** 2026-01-25

## APIs & External Services

**LLM Providers:**

| Provider        | SDK/Client                  | Auth                                       | Models                                            |
| --------------- | --------------------------- | ------------------------------------------ | ------------------------------------------------- |
| **OpenAI**      | `openai` ^6.16.0            | `apiKey` config or `OPENAI_API_KEY` env    | gpt-4o, gpt-4o-mini, o1, o3-mini                  |
| **Anthropic**   | `@anthropic-ai/sdk` ^0.71.2 | `apiKey` config or `ANTHROPIC_API_KEY` env | claude-3-5-sonnet, claude-3-opus, claude-4 series |
| **Ollama**      | `ollama` ^0.6.3             | Optional `apiKey` for remote               | llama3.2, any Ollama model                        |
| **OllamaCloud** | Custom                      | `apiKey` config                            | Cloud-hosted Ollama models                        |
| **OpenRouter**  | OpenAI-compatible           | `apiKey` config                            | Various provider models                           |
| **OpenCode**    | OpenAI-compatible           | `apiKey` config                            | OpenCode models                                   |

**LLM Provider Configuration:**

- Config file: `~/.tiny-agent/config.yaml`
- Location: `src/config/schema.ts`, `src/config/loader.ts`

```yaml
providers:
  openai:
    apiKey: ${OPENAI_API_KEY}
    baseUrl: https://api.openai.com/v1
  anthropic:
    apiKey: ${ANTHROPIC_API_KEY}
  ollama:
    baseUrl: http://localhost:11434
```

## Data Storage

**Configuration:**

- Format: YAML or JSON
- Location: `~/.tiny-agent/config.yaml` (default) or `~/.tiny-agent/config.json`
- Loader: `src/config/loader.ts` with `yaml` package for parsing

**Conversation History:**

- Format: JSON lines
- Default location: `~/.tiny-agent/conversation.json`
- Override: `TINY_AGENT_CONVERSATION_FILE` env var

**Memory/Persistent Context:**

- Format: JSON
- Location: `~/.tiny-agent/memory.json`
- Override: `TINY_AGENT_MEMORY_FILE` env var
- Implementation: `src/core/memory.ts` - Token-aware memory management

**Local Models:**

- Ollama: HTTP connection to `http://localhost:11434` (default)
- Configurable via `baseUrl` in provider config

## Authentication & Identity

**API Key Management:**

- Environment variable interpolation in config: `${VAR_NAME}`
- Example: `apiKey: ${OPENAI_API_KEY}` in config.yaml
- Throws error if referenced env var is not set

**Model Context Protocol (MCP):**

- Provider: `@modelcontextprotocol/sdk` ^1.25.2
- Client: `src/mcp/client.ts` - StdioClientTransport for server communication
- Manager: `src/mcp/manager.ts` - Tool registry integration

**MCP Server Configuration:**

```yaml
mcpServers:
  context7:
    command: npx
    args: ["-y", "@upstash/context7-mcp"]
  serena:
    command: uvx
    args: ["-y", "serena-mcp-server"]
    env:
      SERENA_API_KEY: ${SERENA_API_KEY}
```

## Monitoring & Observability

**Logging:**

- Framework: Console logging with tag prefixes
- Levels: Controlled via `DEBUG`, `RUST_LOG`, `LOG_LEVEL` env vars for MCP servers
- Location: `src/utils/` - Utility functions

**Error Handling:**

- Structured error returns: `{ success: false, error: string }`
- No crash reporting currently implemented

## CI/CD & Deployment

**Hosting:**

- GitHub Repository: jellydn/tiny-coding-agent
- Release automation: GitHub Actions workflows

**CI Pipeline:**

- File: `.github/workflows/ci.yml`
- Runs: Typecheck, lint, test on push/PR

**Release Pipeline:**

- File: `.github/workflows/release.yml`
- Automated releases via bumpp
- Commands: `release:patch`, `release:minor`, `release:major`

**Homebrew:**

- Formula: `.github/homebrew-tiny-agent`
- Distribution via Homebrew cask

## Environment Configuration

**Required env vars for cloud providers:**

| Variable            | Provider  | Required               |
| ------------------- | --------- | ---------------------- |
| `OPENAI_API_KEY`    | OpenAI    | If using OpenAI models |
| `ANTHROPIC_API_KEY` | Anthropic | If using Claude models |
| `OLLAMA_HOST`       | Ollama    | For non-local Ollama   |

**Optional env vars:**

| Variable                        | Purpose                   |
| ------------------------------- | ------------------------- |
| `TINY_AGENT_CONFIG_YAML`        | Override config file path |
| `TINY_AGENT_CONFIG_JSON`        | Override JSON config path |
| `TINY_AGENT_MODEL`              | Override default model    |
| `TINY_AGENT_SYSTEM_PROMPT`      | Override system prompt    |
| `TINY_AGENT_CONVERSATION_FILE`  | Conversation history path |
| `TINY_AGENT_MEMORY_FILE`        | Memory storage path       |
| `TINY_AGENT_MAX_CONTEXT_TOKENS` | Max context window        |
| `TINY_AGENT_MAX_MEMORY_TOKENS`  | Max memory tokens         |

**MCP Server Environment:**

- MCP servers run as child processes
- Safe env vars passed through: `PATH`, `HOME`, `USER`, `TERM`, `EDITOR`, etc.
- Custom env vars configured per server in config

## Webhooks & Callbacks

**MCP Tool Callbacks:**

- MCP servers provide tools via stdio transport
- Tool invocation: `src/mcp/client.ts` `callTool()` method
- Results returned as `{ content: Array, isError: boolean }`

**Outgoing Webhooks:**

- Not currently implemented as a feature
- Could be added via custom tools or MCP servers

## Skills & Plugins

**Skill Loading:**

- Format: Markdown with YAML frontmatter
- Location: `~/.tiny-agent/skills/` and `./.skills/` (default)
- Embedded skills: Generated at build time in `src/skills/embedded-content.ts`
- Loader: `src/skills/loader.ts`

**Plugin System:**

- Directory-based plugin loading: `src/tools/plugin-loader.ts`
- Plugins discovered from skill directories
- Signature verification: `src/skills/signature.ts` with `node:crypto`

---

_Integration audit: 2026-01-25_
