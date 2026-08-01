# ARCHITECTURE.md — System Architecture

## Overview

tiny-agent is a CLI-based AI coding assistant that runs an agent loop:
1. User sends a prompt
2. System prepares context (memory, skills, tools)
3. LLM generates a response (streaming)
4. If LLM requests tool calls → execute tools → loop back to step 3
5. If LLM provides final answer → stream to user → done

## Layer Diagram

```
┌─────────────────────────────────────────────────┐
│                   CLI Layer                       │
│  main.tsx → command-dispatch → handlers/          │
│  shared.ts (agent setup, tool registry, auth)     │
└────────────────────┬────────────────────────────┘
                     │ creates Agent
┌────────────────────▼────────────────────────────┐
│                  Core Layer                       │
│  Agent (orchestrator)                             │
│  ├─ StreamProcessor (iteration loop)              │
│  ├─ TurnExecutor (tool dispatch + error recovery) │
│  ├─ SkillManager (skill loading + filtering)      │
│  ├─ MemoryStore (memory persistence)              │
│  ├─ ConversationManager (chat history)            │
│  └─ ProviderCache (LLM client caching)            │
└────────────────────┬────────────────────────────┘
                     │ uses
┌────────────────────▼────────────────────────────┐
│               Provider Layer                      │
│  LLMClient interface                              │
│  ├─ OpenAIProvider (GPT, OpenCode, OpenRouter)    │
│  ├─ AnthropicProvider (Claude)                    │
│  ├─ OllamaProvider (local models)                 │
│  ├─ QwenCloudProvider (Qwen/DeepSeek)            │
│  └─ ZaiProvider (GLM models)                      │
│                                                   │
│  Factory: createProvider() selects by config      │
│  ModelRegistry: detectProvider(), capabilities    │
└────────────────────┬────────────────────────────┘
                     │ executes
┌────────────────────▼────────────────────────────┐
│                  Tool Layer                        │
│  ToolRegistry → Tool[]                            │
│  ├─ file-tools (read/write/edit/delete)           │
│  ├─ bash-tool (shell execution)                   │
│  ├─ search-tools (grep/glob)                      │
│  ├─ web-search-tool (DuckDuckGo)                  │
│  ├─ skill-tool (skill loading)                    │
│  └─ MCP tools (dynamic, from MCP servers)         │
│                                                   │
│  ToolExecutor → executeToolCalls()                │
│  Confirmation: dangerous tool prompts             │
└─────────────────────────────────────────────────┘
```

## Key Patterns

### Agent Loop (StreamProcessor)
```
User Prompt → Prepare Context → StreamProcessor.process()
  → [for each iteration]:
      → streamLlmResponse() (LLM streaming)
      → if tool calls: executeToolCalls() → append results → continue
      → if no tool calls: yield final answer → break
      → if loop detected: streamFinalAnswer() → break
      → if max iterations: yield maxIterationsReached → break
  → yield StreamChunk objects to UI
```

### Provider Abstraction
- `LLMClient` interface: `chat()` + `stream()` + `getCapabilities()`
- `ProviderFactory` maps config → provider class
- `ProviderCache` caches LLM clients per model
- `ModelRegistry` detects provider from model name pattern

### Tool System
- `Tool` interface: name, description, parameters (JSON Schema), execute
- `ToolRegistry` manages tool registration and batch execution
- `TurnExecutor` handles per-iteration tool dispatch + error recovery
- `ToolExecutor` wraps turn execution with observability
- Confirmation system for dangerous operations

### Configuration
- YAML config at `~/.config/tiny-agent/config.yaml`
- Zod schema validation (`Config` type)
- Environment variable interpolation
- `AGENTS.md` loaded as system prompt prefix

## Data Flow

```
User Input
  → parseChatCommand() or direct prompt
  → Agent.runStream()
    → prepareContext() (memory + truncation)
    → StreamProcessor.process()
      → streamLlmResponse() (provider-specific)
      → executeToolCalls() (tool dispatch)
      → yield AgentStreamChunk (UI updates)
  → ChatContext (React state)
  → Ink components (terminal rendering)
```

## Observability

- `AgentObservability` wraps each request with OpenTelemetry spans
- `RunnerObservability` tracks per-run metrics (LLM calls, tool calls, cost)
- `DebugLogger` verbose logging for development
- `Langfuse` integration (optional) for trace export
- `Telemetry` anonymous usage tracking
