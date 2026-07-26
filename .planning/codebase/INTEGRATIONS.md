# External Integrations

## LLM Providers (`src/providers/`)

Each provider implements the same interface (`src/providers/types.ts`) and is wired up by `src/providers/factory.ts` based on a `model-string` like `provider/model-name`.

| Provider | File | Notes |
|---|---|---|
| OpenAI | `src/providers/openai.ts` | Native OpenAI SDK; also used as the OpenAI-compatible shim. Uses `openai-protocol.ts` for chat/stream message conversion. |
| Anthropic | `src/providers/anthropic.ts` | `@anthropic-ai/sdk`. Tool format adapter (`toAnthropicFormat`). |
| Ollama | `src/providers/ollama.ts` | Local model server. Pulls model list dynamically. |
| Ollama Cloud | `src/providers/ollama-cloud.ts` | Hosted variant. |
| OpenRouter | `src/providers/openrouter.ts` | Multi-model aggregator (OpenAI-compatible). |
| OpenCode | `src/providers/opencode.ts` | Custom gateway. |
| z.ai (GLM) | `src/providers/zai.ts` | Custom provider for z.ai models. |
| Models registry | `src/providers/models-dev.ts` | Fetches the open `models.dev` JSON to populate the registry at startup. |
| Registry / capability map | `src/providers/model-registry.ts`, `src/providers/capabilities.ts` | Single source of truth for which models support tools, vision, JSON mode, etc. |

The registry is loaded once at startup, cached, and re-used by every provider.

## Model Context Protocol (`src/mcp/`)

- **MCP client**: `src/mcp/client.ts` + `src/mcp/manager.ts` — supports stdio and HTTP transports.
- Servers are configured under `mcp.servers` in the user's `tiny-agent.json`.
- Each connected server's tools are registered into the local `ToolRegistry` so they're addressable like any other tool (`mcp_<server>_<tool>`).
- Error type lives in `src/mcp/types.ts`.

## Web Search (`src/tools/web-search-tool.ts`)

- Provider abstraction in `src/tools/search-providers/provider.ts`.
- Concrete provider: **DuckDuckGo** (`src/tools/search-providers/duckduckgo.ts`).
- Falls back gracefully when the network is unavailable.

## Skills (`src/skills/`)

- Implements the [agentskills.io](https://agentskills.io) spec.
- `SKILL.md` discovery walks the configured skills directories (project + user `~/.config/tiny-agent/skills/`).
- Frontmatter parsed via `src/skills/parser.ts`; loader in `src/skills/loader.ts`; builtin registry in `src/skills/builtin-registry.ts`.
- For the binary build, skills are embedded via `scripts/generate-embedded-skills.ts` → `src/skills/embedded-content.ts` so no runtime filesystem access is needed for the default skills.

## Observability (`src/observability/`)

- **Langfuse** integration (`src/observability/langfuse.ts`) — opt-in via env vars (`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`).
- **Token usage tracking** (`src/observability/token-usage.ts`) and cost estimation (`src/observability/cost.ts`) using `src/observability/pricing.ts` + `src/observability/model-pricing.json`.
- **Structured logger** (`src/observability/logger.ts`) with redaction (`src/observability/redact.ts`) — strips API keys, env-style secrets.
- **Telemetry** (`src/observability/telemetry.ts`), **trace context** (`src/observability/trace-context.ts`).
- All providers emit events into this layer when configured.

## File System / Process

- Native Node `node:fs/promises`, `node:path`, `node:readline`, `node:child_process`.
- No external filesystem abstraction; tools layer wraps `fs` calls into typed `Tool` definitions.

## Upgrade Channel

- Self-update via `tiny-agent --upgrade` (handler in `src/cli/handlers/upgrade.ts`) — downloads the latest release from GitHub and atomically swaps the binary.
- Version metadata generated from `package.json` at build time.
