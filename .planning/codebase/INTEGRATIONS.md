# External Integrations

**Analysis Date:** 2026-01-25

## APIs & External Services

**LLM Providers (Multi-Provider Architecture):**

| Provider        | SDK/Client                 | Purpose                         | Auth                                                |
| --------------- | -------------------------- | ------------------------------- | --------------------------------------------------- |
| **OpenAI**      | `openai` 6.16.0            | GPT-4, GPT-3.5-turbo, o1 models | `OPENAI_API_KEY` env var                            |
| **Anthropic**   | `@anthropic-ai/sdk` 0.71.2 | Claude 3.5 Sonnet/Haiku/Opus    | `ANTHROPIC_API_KEY` env var                         |
| **Ollama**      | `ollama` 0.6.3             | Local/remote Ollama models      | `OLLAMA_BASE_URL` (default: http://localhost:11434) |
| **OllamaCloud** | `ollama` (custom)          | Cloud Ollama API                | `OLLAMA_CLOUD_API_KEY` env var                      |
| **OpenRouter**  | `openai` (wrapped)         | Unified LLM API aggregator      | `OPENROUTER_API_KEY` env var                        |
| **OpenCode**    | `openai` (wrapped)         | OpenCode AI models              | `OPENCODE_API_KEY` env var                          |

**Provider Configuration:**

```yaml
providers:
  openai:
    apiKey: ${OPENAI_API_KEY}
    baseUrl: optional-custom-endpoint
  anthropic:
    apiKey: ${ANTHROPIC_API_KEY}
  ollama:
    baseUrl: http://localhost:11434
  ollamaCloud:
    apiKey: ${OLLAMA_CLOUD_API_KEY}
    baseUrl: https://ollama.com
  openrouter:
    apiKey: ${OPENROUTER_API_KEY}
    baseUrl: https://openrouter.ai/api/v1
  opencode:
    apiKey: ${OPENCODE_API_KEY}
    baseUrl: https://opencode.ai/zen/v1
```

## Data Storage

**Databases:**

- None - No external database dependencies

**File Storage:**

- Local filesystem only
- Conversation history: `~/.tiny-agent/conversation.json` (configurable via `TINY_AGENT_CONVERSATION_FILE`)
- Memory/persistent context: `~/.tiny-agent/memory.json` (configurable via `TINY_AGENT_MEMORY_FILE`)
- Config files: `~/.tiny-agent/config.yaml` or `~/.tiny-agent/config.json`

**Caching:**

- None - In-memory token counting via `tiktoken`
- Bun runtime module cache

## Authentication & Identity

**Auth Provider:**

- API keys for each LLM provider
- Env var injection into config via `${VAR_NAME}` interpolation
- No OAuth or identity provider integration

## Web Search & External APIs

**Web Search:**

- DuckDuckGo HTML search (`src/tools/web-search-tool.ts`)
- Direct HTTP fetch to `https://html.duckduckgo.com/html/`
- No API key required

**NPM Registry:**

- Direct HTTP fetch to `https://registry.npmjs.org/{package}/latest`
- Used by web search tool for package version lookups

## MCP (Model Context Protocol)

**Integration:** `@modelcontextprotocol/sdk` 1.25.2

**Purpose:** Extensible tool system via MCP servers

**Default MCP Servers:**

- **Context7**: Documentation lookups via `@upstash/context7-mcp`
  - Command: `npx -y @upstash/context7-mcp`
  - Zero dependencies, provides library documentation

**MCP Configuration:**

```yaml
mcpServers:
  context7:
    command: npx
    args: ["-y", "@upstash/context7-mcp"]
  # serena:
  #   command: uvx
  #   args:
  #     - "--from"
  #     - "git+https://github.com/oraios/serena"
  #     - "serena-mcp-server"
```

**MCP Environment Variables:**

- Supports `env` block in server config
- DEBUG, RUST_LOG, LOG_LEVEL set to empty/error by default

## Skills System

**Skill Loading:** Local filesystem and embedded skills (`src/skills/loader.ts`)

**Skill Directories:**

- `~/.tiny-agent/skills/` (user skills)
- `./.skills/` (project skills)

**Skill Format:** `SKILL.md` files with YAML frontmatter

**Embedded Skills:** Built-in skills bundled in binary

## CI/CD & Deployment

**Hosting:**

- GitHub repository: `jellydn/tiny-coding-agent`
- GitHub Actions for CI/CD

**CI Pipeline:**

- Type checking via `tsc --noEmit`
- Linting via `oxlint`
- Formatting check via `oxfmt --check`
- Tests via `bun test` on Ubuntu and macOS
- Binary build via `bun build --compile --outfile=tiny-agent`

**Release Pipeline:**

- Semantic versioning via `bumpp`
- Release workflow: `release.yml`
- Binary artifacts uploaded to GitHub Actions

## Environment Configuration

**Required env vars for providers:**

- `OPENAI_API_KEY` - OpenAI API key
- `ANTHROPIC_API_KEY` - Anthropic API key
- `OPENROUTER_API_KEY` - OpenRouter API key
- `OPENCODE_API_KEY` - OpenCode API key
- `OLLAMA_CLOUD_API_KEY` - Ollama Cloud API key

**Optional env vars:**

- `TINY_AGENT_MODEL` - Override default model
- `TINY_AGENT_SYSTEM_PROMPT` - Override system prompt
- `TINY_AGENT_CONVERSATION_FILE` - Override conversation file path
- `TINY_AGENT_MEMORY_FILE` - Override memory file path
- `TINY_AGENT_MAX_CONTEXT_TOKENS` - Override max context tokens
- `TINY_AGENT_MAX_MEMORY_TOKENS` - Override max memory tokens
- `TINY_AGENT_CONFIG_YAML` - Override config YAML path
- `TINY_AGENT_CONFIG_JSON` - Override config JSON path

**Secrets location:**

- Environment variables (recommended)
- Config file with `${VAR_NAME}` interpolation
- No secret management service integration

## Monitoring & Observability

**Error Tracking:**

- None - Errors returned as structured results

**Logs:**

- Console output via CLI (ink rendering)
- MCP server logs suppressed (stderr: "ignore")
- No external logging service

---

_Integration audit: 2026-01-25_
