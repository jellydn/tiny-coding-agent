# External Integrations

## LLM Providers (`src/providers/`)

Each provider implements the same interface (`src/providers/types.ts`) and is wired up by `src/providers/factory.ts` based on a `model-string` like `provider/model-name`.

| Provider | File | Notes |
|---|---|---|
| OpenAI | `src/providers/openai.ts` | Native OpenAI SDK; also used as the OpenAI-compatible shim. Uses `openai-protocol.ts` for chat/stream message conversion. |
| Anthropic | `src/providers/anthropic.ts` | `@anthropic-ai/sdk`. Tool format adapter (`toAnthropicFormat`). |
| Ollama | `src/providers/ollama.ts` | Local model server. Pulls model list dynamically. |
| Ollama Cloud | `src/providers/ollama-cloud.ts` | Hosted variant. |
| OpenRouter | `src/providers/openrouter.ts` | Multi-model aggregator (OpenAI-compatible). Looks up capabilities from models.dev. |
| OpenCode | `src/providers/opencode.ts` | Custom gateway with curated coding models. |
| Z.AI (GLM) | `src/providers/zai.ts` | Custom provider for z.ai / Zhipu models (GLM-4.7, etc). |
| ClinePass | `src/providers/clinepass.ts` | Live model lookup via `GET /api/v1/models` (ADR-013). |
| QwenCloud | `src/providers/qwencloud.ts` | OpenAI-compatible API for Qwen3.x, DeepSeek V4, and GLM-5.2 models. Uses `qw/` prefix. Static API key (Token Plan). |
| Models registry | `src/providers/models-dev.ts` | Fetches the open `models.dev` JSON to populate the registry at startup. |
| Registry / capability map | `src/providers/model-registry.ts`, `src/providers/capabilities.ts` | Single source of truth for which models support tools, vision, JSON mode, etc. |
| Factory | `src/providers/factory.ts` | Model-string → provider instance. Parses `provider/model-name` strings. |

The registry is loaded once at startup, cached, and re-used by every provider. The `detectProvider(modelString)` function in `model-registry.ts` maps a model string to its provider key.

## Login/Logout Onboarding (`src/cli/handlers/login.ts`)

- **`tiny-agent login`** — Interactive provider picker with masked API key entry (`promptHidden`). Writes literal keys to `~/.tiny-agent/config.yaml` with `0o600` permissions when a literal key is present (via `src/config/config-io.ts`).
- **`tiny-agent logout`** — Removes a provider's `apiKey` from config. Prompts for a new `defaultModel` if the logged-out provider was the active one. Refuses for Ollama (no key).
- **`/login` in chat** — Status-only (shows connection status + onboarding guidance). No key collection in the Ink UI (ADR-014).
- **`/logout` in chat** — Shows logout guidance (delegates to top-level `tiny-agent logout`).
- **ADR-014** documents the design decisions: top-level dispatch before `loadConfig()`, chat is status-only, literal key storage with env-var tip.

## Model Context Protocol (`src/mcp/`)

- **MCP client**: `src/mcp/client.ts` + `src/mcp/manager.ts` — supports stdio and HTTP transports.
- Servers are configured under `mcpServers` in the user's `~/.tiny-agent/config.yaml`.
- Each connected server's tools are registered into the local `ToolRegistry` so they're addressable like any other tool (`mcp_<server>_<tool>`).
- Error type lives in `src/mcp/types.ts`.
- CLI management via `src/cli/handlers/mcp.ts` (`tiny-agent mcp list/enable/disable/add`).

## Web Search (`src/tools/web-search-tool.ts`)

- Provider abstraction in `src/tools/search-providers/provider.ts`.
- Concrete provider: **DuckDuckGo** (`src/tools/search-providers/duckduckgo.ts`).
- Falls back gracefully when the network is unavailable.

## Skills (`src/skills/`)

- Implements the [agentskills.io](https://agentskills.io) spec.
- `SKILL.md` discovery walks the configured skills directories (project + user `~/.config/tiny-agent/skills/`).
- Frontmatter parsed via `src/skills/parser.ts`; loader in `src/skills/loader.ts`; builtin registry in `src/skills/builtin-registry.ts`.
- For the binary build, skills are embedded via `scripts/generate-embedded-skills.ts` → `src/skills/embedded-content.ts` so no runtime filesystem access is needed for the default skills.
- Built-in skill: `code-simplifier` (`src/skills/builtin/code-simplifier/SKILL.md`).

## Observability (`src/observability/`)

- **Langfuse** integration (`src/observability/langfuse.ts`) — opt-in via env vars (`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`).
- **OpenTelemetry** (`src/observability/telemetry.ts`) — console exporter by default, configurable for OTLP backend.
- **Token usage tracking** (`src/observability/token-usage.ts`) and cost estimation (`src/observability/cost.ts`) using `src/observability/pricing.ts` + `src/observability/model-pricing.json`.
- **Structured logger** (`src/observability/logger.ts`) with redaction (`src/observability/redact.ts`) — strips API keys, env-style secrets.
- **Trace context** (`src/observability/trace-context.ts`) — unique `traceId` per run, propagated through retrieval, tool execution, and LLM calls.

## File System / Process

- Native Node `node:fs/promises`, `node:path`, `node:readline`, `node:child_process`.
- No external filesystem abstraction; tools layer wraps `fs` calls into typed `Tool` definitions.
- Config I/O centralized in `src/config/config-io.ts` (YAML/JSON dispatch, `0o600` permissions, `containsLiteralApiKey`).

## Upgrade Channel

- Self-update via `tiny-agent --upgrade` (handler in `src/cli/handlers/upgrade.ts`) — downloads the latest release from GitHub and atomically swaps the binary.
- Version metadata generated from `package.json` at build time via `scripts/generate-version.ts`.

## Lifecycle Hooks (`src/hooks/`)

Hooks allow external commands to intercept the agent's lifecycle at defined points — review plans, modify content, approve or reject before execution. This is the foundation for human-in-the-loop integrations like [plannotator](https://github.com/backnotprop/plannotator).

- **Types** (`src/hooks/types.ts`) — `HookEvent` (`post-plan-generate`, `pre-build-execute`, `post-explore-complete`), `HookConfig`, `HookInput`, `HookResult`, `HookPreset`, `HookRegistry`.
- **Manager** (`src/hooks/manager.ts`) — `buildRegistry()`, `hasHooks()`, `executeHook()` (spawn + stdin/stdout pipe), `runHooks()` (sequential pipeline — each hook sees the previous hook's output).
- **Presets** (`src/hooks/presets.ts`) — `PLANNOTATOR_PRESET` (plan-review enabled by default, build-review disabled), `BUILTIN_PRESETS`, `findPreset()`, `listPresetIds()`.
- **Config** — `hooks?: HookConfig[]` field on `Config` in `src/config/schema.ts` + validation.
- **Agent integration** — `planAgent()` calls `runHooks(registry, "post-plan-generate", ...)` after plan generation; `buildAgent()` calls `runHooks(registry, "pre-build-execute", ...)` before execution.
- **CLI** — `tiny-agent hooks` (list/presets/install/enable/disable/remove) via `src/cli/handlers/hooks.ts`; `tiny-agent review` via `src/cli/handlers/review.ts`.
- **Chat** — `/review` chat command runs hooks on the current plan and saves the modified plan.
- **ADR-015** documents the design: external command spawning (not in-process plugins), sequential execution (not parallel), plannotator as a preset (not hardcoded).

Hooks are language-agnostic — any tool that reads stdin and writes stdout can be a hook. Missing binaries degrade to "no hooks," not a crash.

## Plugin System

- Tool plugins via `src/tools/plugin-loader.ts` — drop a `.ts`/`.js` file exporting `Tool` into `~/.tiny-agent/plugins/` and it gets registered at startup.
- Plugins run with the agent's full permissions (no sandbox) — see `SECURITY.md` for risks.
