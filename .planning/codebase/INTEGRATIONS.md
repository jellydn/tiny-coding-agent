# External Integrations

## LLM Providers
| Provider | Package | Auth Method |
|----------|---------|-------------|
| **OpenAI** | `openai` | API key |
| **Anthropic** | `@anthropic-ai/sdk` | API key |
| **Ollama** | `ollama` | Local (no auth) |
| **Ollama Cloud** | `openai` SDK | API key |
| **OpenRouter** | `openai` SDK | API key |
| **OpenCode** | Custom protocol | API token |
| **Zai (Zhipu AI)** | `openai` SDK | API key |
| **QwenCloud** | `openai` SDK | API key |
| **ClinePass** | `openai` SDK | API key |

All providers are abstracted behind a common `LLMClient` interface in `src/providers/types.ts`. New providers implement this interface.

## Model Registry
- Models are registered in `src/providers/model-registry.ts`
- Live provider lookup via `src/providers/clinepass.ts` (models.dev API)
- Capability detection in `src/providers/capabilities.ts`
- Device-specific models in `src/providers/models-dev.ts`

## MCP (Model Context Protocol)
- Client: `@modelcontextprotocol/sdk` ^1.25.2
- Manager: `src/mcp/manager.ts`
- Supports stdio transport for local MCP servers
- MCP servers provide dynamically registered tools

## Observability (Optional)
- **OpenTelemetry**: `@opentelemetry/api` + `@opentelemetry/sdk-trace-base`
- **Langfuse**: Optional integration via `langfuse` package
- Observability wrapper: `src/observability/`

## Configuration
- User config: `~/.tiny-agent/config.yaml`
- Config loaded via `src/config/loader.ts`
- Schema validated with `zod`

## Tools
- **Bash**: Local shell execution via `src/tools/bash-tool.ts`
- **File operations**: read, write, edit, delete, glob, grep via `src/tools/file-tools.ts` and `src/tools/search-tools.ts`
- **Web search**: DuckDuckGo integration via `src/tools/web-search-tool.ts`
- **SKILL.md**: Skill discovery from directories and built-in registry
