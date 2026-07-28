# External Integrations

## LLM Providers

The agent supports multiple LLM providers through a unified `LLMClient` interface (`src/providers/types.ts`). Provider selection is automatic via model-string prefix detection (`src/providers/model-registry.ts`).

| Provider | Key | File | API Key Env Var | Default Model |
|----------|-----|------|-----------------|---------------|
| OpenAI | `openai` | `src/providers/openai.ts` | `OPENAI_API_KEY` | `gpt-4o` |
| Anthropic | `anthropic` | `src/providers/anthropic.ts` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-20250514` |
| Ollama (Local) | `ollama` | `src/providers/ollama.ts` | — (no key) | `qwen3-coder` |
| Ollama (Cloud) | `ollamaCloud` | `src/providers/ollama-cloud.ts` | `OLLAMA_CLOUD_API_KEY` | `gpt-oss:120b-cloud` |
| OpenRouter | `openrouter` | `src/providers/openrouter.ts` | `OPENROUTER_API_KEY` | `openrouter/openai/gpt-4o` |
| OpenCode | `opencode` | `src/providers/opencode.ts` | `OPENCODE_API_KEY` | `opencode/big-pickle` |
| Z.AI (Zhipu) | `zai` | `src/providers/zai.ts` | `ZAI_API_KEY` | `glm-4.7` |
| ClinePass | `clinepass` | `src/providers/clinepass.ts` | `CLINE_API_KEY` | `cline-pass/glm-5.2` |
| QwenCloud | `qwencloud` | `src/providers/qwencloud.ts` | `QWENCLOUD_API_KEY` | `qw/glm-5.2` |

### Provider Architecture

- **Factory**: `src/providers/factory.ts` — `createProvider({model, provider, providers})` returns `LLMClient`
- **Model Registry**: `src/providers/model-registry.ts` — `detectProvider(model)` maps model strings to provider types
- **Capabilities**: `src/providers/capabilities.ts` — checks model features (thinking, tools, context window)
- **Models.dev**: `src/providers/models-dev.ts` — fetches live model metadata from models.dev
- **OpenAI Protocol**: `src/providers/openai-protocol.ts` — shared base for OpenAI-compatible providers

### Provider Onboarding

- `tiny-agent login` — interactive provider picker (`src/cli/handlers/login.ts`)
- `tiny-agent login <provider>` — direct provider configuration
- `tiny-agent login status` — show connection status
- `tiny-agent logout <provider>` — remove API key from config
- Config stored at `~/.tiny-agent/config.yaml` with literal key + env-var tip (ADR-014)

## MCP (Model Context Protocol)

External tool servers connected via the Model Context Protocol.

| Component | File | Purpose |
|-----------|------|---------|
| Manager | `src/mcp/manager.ts` | Server lifecycle, tool registration, globToRegex pattern matching |
| Client | `src/mcp/client.ts` | MCP protocol client (stdio transport) |
| Types | `src/mcp/types.ts` | `McpToolDefinition`, `McpToolCallResult`, `McpConnection` |

### Configuration

```yaml
mcpServers:
  server-name:
    command: "npx"
    args: ["-y", "@some/mcp-server"]
    enabled: true
```

- Servers defined in `config.yaml` under `mcpServers`
- Tools auto-registered into the `ToolRegistry` with `mcp_` prefix
- `disabledMcpPatterns` config option for filtering MCP tools by glob pattern
- Server status shown via `tiny-agent status` and `/mcp` chat command

## Lifecycle Hooks

External commands triggered at lifecycle events (ADR-015).

| Component | File | Purpose |
|-----------|------|---------|
| Types | `src/hooks/types.ts` | `HookConfig`, `HookEvent`, `HookRegistry` |
| Manager | `src/hooks/manager.ts` | `buildRegistry()`, `runHooks()`, `hasHooks()` |
| Presets | `src/hooks/presets.ts` | `PLANNOTATOR_PRESET`, `findPreset()`, `listPresetIds()` |
| CLI Handler | `src/cli/handlers/hooks.ts` | `tiny-agent hooks list/install/enable/disable/remove` |

### Hook Events

| Event | Triggered After | Input |
|-------|-----------------|-------|
| `post-plan-generate` | Plan agent generates a plan | Plan content + task description |
| `pre-build-execute` | Build agent starts executing | Plan content + state file path |
| `post-build-execute` | Build agent finishes | Build results |

### Plannotator Preset

The built-in `plannotator` preset (`src/hooks/presets.ts`) installs two hooks:
- `post-plan-generate` — review plan content
- `pre-build-execute` — review build plan before execution

Install: `tiny-agent hooks install plannotator`

### Hook Configuration

```yaml
hooks:
  - name: my-review-hook
    event: post-plan-generate
    command: ./review.sh
    args: ["--plan"]
    inputMode: stdin
    enabled: true
    timeoutMs: 0
    applyModifications: true
```

## Web Search

| Component | File | Purpose |
|-----------|------|---------|
| Web Search Tool | `src/tools/web-search-tool.ts` | Tool definition for LLM-initiated web search |
| DuckDuckGo Provider | `src/tools/search-providers/duckduckgo.ts` | DuckDuckGo HTML scraping search backend |
| Search Provider Interface | `src/tools/search-providers/provider.ts` | `SearchProvider` interface |
| Search Tools | `src/tools/search-tools.ts` | `grep` and `glob` file search tools |

## Observability / Telemetry

### OpenTelemetry

- **SDK**: `@opentelemetry/api` + `@opentelemetry/sdk-trace-base`
- **Implementation**: `src/observability/telemetry.ts` — span creation, attribute setting, exporter management
- **Spans**: `llm.request`, `retrieval`, `tool.execution`, `http.request`
- **Console exporter**: `NoopSpanExporter` for disabled mode (no network overhead)

### Langfuse (Optional)

- **Package**: `langfuse` (optional dependency)
- **Implementation**: `src/observability/langfuse.ts`
- **Purpose**: LLM-specific observability with cost tracking
- **Enabled when**: `config.observability.langfuseEnabled` is true

### Structured Logging

- **Implementation**: `src/observability/logger.ts`
- **Events**: `request.start`, `request.end`, `retrieval`, `llm.request`
- **Output**: JSON to stdout (for programmatic consumption) or console
- **Redaction**: `src/observability/redact.ts` — masks API keys in logs

### Cost Estimation

- **Implementation**: `src/observability/cost.ts`, `src/observability/pricing.ts`
- **Data**: `src/observability/model-pricing.json` — per-model token pricing
- **Output**: `CostEstimate` with input/output token costs
