# External Integrations

**Analysis Date:** 2026-01-25

## APIs & External Services

**LLM Providers:**

- **OpenAI** - GPT-4o, GPT-4o-mini, GPT-4-turbo, o1, o3-mini models
  - SDK: `openai` npm package
  - Auth: `OPENAI_API_KEY` or config `providers.openai.apiKey`
  - Base URL: `https://api.openai.com/v1` (configurable)

- **Anthropic** - Claude 3.5, Claude 3 Opus, Claude 4 models
  - SDK: `@anthropic-ai/sdk` npm package
  - Auth: `ANTHROPIC_API_KEY` or config `providers.anthropic.apiKey`
  - Supports thinking/block computation

- **Ollama (Local)** - Local LLM inference
  - SDK: `ollama` npm package + HTTP client
  - Auth: Optional `OLLAMA_API_KEY` for remote Ollama
  - Base URL: `http://localhost:11434` (configurable)
  - Requires Ollama server running locally

- **Ollama Cloud** - Hosted Ollama API
  - Wraps OllamaProvider with cloud endpoint
  - Auth: `OLLAMA_CLOUD_API_KEY` or config `providers.ollamaCloud.apiKey`
  - Base URL: `https://ollama.com` (configurable)

- **OpenRouter** - Unified LLM routing
  - Extends OpenAIProvider with custom base URL
  - Auth: `OPENROUTER_API_KEY` or config `providers.openrouter.apiKey`
  - Base URL: `https://openrouter.ai/api/v1`

- **OpenCode** - Code-focused LLM service
  - Extends OpenAIProvider with custom base URL
  - Auth: `OPENCODE_API_KEY` or config `providers.opencode.apiKey`
  - Base URL: `https://opencode.ai/zen/v1`

## Data Storage

**Databases:**
- None - No external database integration

**File Storage:**
- Local filesystem only
- Config: `~/.tiny-agent/config.yaml` or `config.json`
- Conversation history: `~/.tiny-agent/conversation.jsonl` (file path configurable)
- Memory: `~/.tiny-agent/memory.jsonl` (file path configurable)

**Caching:**
- None - In-memory only

## Authentication & Identity

**Auth Provider:**
- Per-provider API keys
- No unified authentication layer
- Configured via environment variables or config file
- Config loader interpolates `${VAR_NAME}` syntax from environment

## Monitoring & Observability

**Error Tracking:**
- None - Console.error only

**Logs:**
- Console.warn for security warnings and deprecations
- Console.log for verbose plugin signatures (when `TINY_AGENT_VERBOSE=true`)
- No structured logging

## CI/CD & Deployment

**Hosting:**
- Standalone binary (`tiny-agent`) - deploy anywhere
- No cloud hosting dependency

**CI Pipeline:**
- No CI service detected (no GitHub Actions, CircleCI, etc.)
- Release workflow uses `bumpp` for versioning

## Environment Configuration

**Required env vars:**
- Provider API keys (as needed):
  - `OPENAI_API_KEY`
  - `ANTHROPIC_API_KEY`
  - `OLLAMA_API_KEY` (for remote Ollama)
  - `OLLAMA_CLOUD_API_KEY`
  - `OPENROUTER_API_KEY`
  - `OPENCODE_API_KEY`
  - `TAVILY_API_KEY` (optional, for Tavily search)

**Secrets location:**
- Environment variables (recommended)
- Config file with interpolation: `${VAR_NAME}`
- Config file location: `~/.tiny-agent/` (user home directory)

## Webhooks & Callbacks

**Incoming:**
- None - Agent does not expose HTTP endpoints

**Outgoing:**
- MCP server connections via stdio (not HTTP)
- LLM API calls to provider endpoints
- Web search HTTP requests to DuckDuckGo/Tavily

## MCP (Model Context Protocol) Integration

**MCP Servers:**
- **Context7** - Documentation lookups for libraries/frameworks
  - Default enabled
  - Install: `npx -y @upstash/context7-mcp`
  - Zero dependencies on external APIs

- **Serena** - Semantic code operations (optional)
  - Requires `uv` package manager
  - Install: `curl -LsSf https://astral.sh/uv/install.sh | sh`
  - GitHub: `git+https://github.com/oraios/serena`

**MCP Configuration:**
- Config key: `mcpServers` object in config
- Per-server: `command`, `args`, `env`
- Environment filtering: Only safe env vars passed to MCP servers
- Tool filtering: `disabledMcpPatterns` glob patterns to exclude tools

**MCP Client:**
- Location: `src/mcp/client.ts`
- Transport: StdioClientTransport
- Tool discovery: Auto-discovers tools on connection
- Error handling: Connection failures logged, agent continues

## Search Integration

**Search Providers:**

- **DuckDuckGo** - Free HTML-based search
  - Requires: No API key
  - Implementation: HTML scraping (fragile, no rate limits)
  - Location: `src/tools/search-providers/duckduckgo.ts`
  - User-Agent: Chrome browser spoofing to avoid blocking

- **Tavily** - API-based search (optional)
  - Requires: `TAVILY_API_KEY`
  - Implementation: TavilyProvider (code exists, needs import)
  - Better reliability than DuckDuckGo scraping

**Web Search Tool:**
- Location: `src/tools/web-search-tool.ts`
- Configurable provider via `setGlobalSearchProvider()`
- Supports timeout and result limits

## Skill/Plugin System

**Skill Loading:**
- Location: `src/skills/` directory
- File format: `SKILL.md` with YAML frontmatter
- Directories: `~/.tiny-agent/skills/`, `./.skills/`
- Embedded skills: Baked into binary at build time

**Skill Signing:**
- Cryptographic signature verification
- Location: `src/skills/signature.ts`
- Uses Node.js crypto module
- Optional: `TINY_AGENT_WARN_UNSIGNED=true` for unsigned warnings

---

*Integration audit: 2026-01-25*
