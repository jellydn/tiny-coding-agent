# INTEGRATIONS.md — External Services & APIs

## LLM Providers

### OpenAI (`openai` v7)
- **Used by**: `OpenAIProvider`, `OpenCodeProvider`, `OpenRouterProvider`, `ClinePassProvider`
- **API**: Chat Completions API (`/v1/chat/completions`)
- **Features**: Streaming, tool calls, function calling
- **Config**: `OPENAI_API_KEY` or config `providers.openai.apiKey`
- **Models**: GPT-4o, GPT-4-turbo, o1, o3, etc.

### Anthropic (`@anthropic-ai/sdk` v0.115)
- **Used by**: `AnthropicProvider`
- **API**: Messages API (`/v1/messages`)
- **Features**: Streaming, tool use, extended thinking
- **Config**: `ANTHROPIC_API_KEY` or config `providers.anthropic.apiKey`
- **Models**: Claude 3.5 Sonnet, Claude 3 Opus, Claude 4, etc.
- **Note**: Uses `anthropic-converters.ts` for message format conversion

### Ollama (`ollama` v0.6)
- **Used by**: `OllamaProvider`, `OllamaCloudProvider`
- **API**: Ollama REST API (`/api/chat`, `/api/tags`)
- **Features**: Local inference, model pulling, streaming
- **Config**: `OLLAMA_HOST` or config `providers.ollama.baseUrl`
- **Models**: llama3, codellama, deepseek, etc.

### QwenCloud
- **Used by**: `QwenCloudProvider`
- **API**: OpenAI-compatible API
- **Config**: `QWENCLOUD_API_KEY` or config `providers.qwencloud.apiKey`
- **Models**: Qwen 3.7, DeepSeek V4, etc.

### Z.ai (GLM)
- **Used by**: `ZaiProvider`
- **API**: OpenAI-compatible API
- **Config**: `ZAI_API_KEY` or config `providers.zai.apiKey`
- **Models**: GLM-5.2, etc.

### OpenRouter
- **Used by**: `OpenRouterProvider`
- **API**: OpenAI-compatible API with model routing
- **Config**: `OPENROUTER_API_KEY` or config `providers.openrouter.apiKey`
- **Models**: Any model available on OpenRouter

### ClinePass
- **Used by**: `ClinePassProvider`
- **API**: OpenAI-compatible API (pass-through)
- **Config**: `CLINEPASS_API_KEY` or config `providers.clinepass.apiKey`

## Model Catalog

### @tokenlens/models v1.3
- **Used by**: `models-dev.ts`
- **Purpose**: Model capabilities database (context windows, max output, tool support)
- **Data**: `providersCatalog` from the package
- **Fallback**: Local model window map in `AnthropicProvider.getCapabilities()`

## Observability

### OpenTelemetry (`@opentelemetry/api` v1.9)
- **Used by**: `telemetry.ts`
- **Purpose**: Distributed tracing, span management
- **Exporters**: Console (default), optional Langfuse
- **Configuration**: `observability.telemetry.enabled` in config

### Langfuse (optional, `langfuse` v3.38)
- **Used by**: `langfuse.ts`
- **Purpose**: LLM observability platform (traces, generations, costs)
- **Config**: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`
- **Optional**: Loaded dynamically, not required

### Telemetry
- **Used by**: `telemetry.ts`
- **Purpose**: Anonymous usage analytics
- **Config**: `observability.telemetry.enabled` in config
- **Data**: Session counts, provider usage, error rates

## Tool Integrations

### Model Context Protocol (MCP)
- **SDK**: `@modelcontextprotocol/sdk` v1.25
- **Used by**: `McpClient`, `McpManager`
- **Purpose**: Dynamic tool discovery from external MCP servers
- **Transport**: stdio (subprocess communication)
- **Config**: `mcp.servers` in config YAML

### DuckDuckGo Search
- **Used by**: `DuckDuckGoProvider`
- **Purpose**: Web search for research queries
- **API**: DuckDuckGo Instant Answers API
- **No API key required**

## Build & Release

### Bun
- **Purpose**: Runtime, bundler, package manager
- **Build**: `bun build --compile` creates standalone binary
- **Tests**: `bun test` (built-in test runner)

### Biome
- **Purpose**: Linting and formatting
- **Config**: `biome.json`
- **Rules**: Recommended + custom (noNonNullAssertion off)

### Husky
- **Purpose**: Git hooks (pre-commit)
- **Hook**: Runs `biome check` on staged files

### bumpp
- **Purpose**: Version bumping + git tags
- **Config**: `bump.config.ts`
- **Workflow**: test → typecheck → lint → bumpp → push

### Renovate
- **Purpose**: Automated dependency updates
- **Config**: `renovate.json`
- **Strategy**: Group minor/patch, separate major

### Homebrew
- **Formula**: `homebrew-tiny-agent/tiny-agent.rb`
- **Purpose**: macOS installation via `brew install`

## File System

### Configuration
- **Path**: `~/.config/tiny-agent/config.yaml` (XDG compliant)
- **Format**: YAML with env var interpolation
- **Schema**: Zod-validated `Config` type

### State
- **Path**: Configurable (default: `~/.config/tiny-agent/state.json`)
- **Purpose**: Agent phase tracking, build progress

### Memory
- **Path**: Configurable (default: `~/.config/tiny-agent/memory.json`)
- **Purpose**: Persistent memory across sessions
- **Format**: JSON with LRU eviction

### Skills
- **Builtin**: Embedded in `src/skills/embedded-content.ts`
- **Custom**: `~/.config/tiny-agent/skills/` directory
- **Discovery**: YAML frontmatter parsing
