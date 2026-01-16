# ADR-007: Model Registry Pattern for Provider Detection

**Status:** Accepted
**Date:** 2026-01-16
**Deciders:** huynhdung

## Context

The current provider detection system has significant issues:

1. **Duplicate Logic**: Both `factory.ts` and `cli/main.ts` contain independent provider detection code (lines 109-141 in main.ts)
2. **Fragile Prefix Matching**: Simple string prefix checks fail for modern models like `llama3.2`, `deepseek-r1`, `qwen3-coder`
3. **No Runtime Switching**: Model and thinking mode are fixed at startup; cannot change during a conversation
4. **Hardcoded Capabilities**: Thinking mode detection is hardcoded in each provider

The existing ADR-002 established provider abstraction, but the detection mechanism itself has become a maintenance burden and doesn't scale with the rapidly evolving model landscape.

## Decision

Adopt a **Model Registry Pattern** - a declarative database of model patterns with capability metadata:

```typescript
interface ModelEntry {
  provider: "openai" | "anthropic" | "ollama" | "openrouter" | "opencode";
  supportsThinking: boolean;
  supportsTools: boolean;
  patterns: string[]; // Regex patterns for matching
}

const MODEL_DATABASE: ModelEntry[] = [
  {
    provider: "anthropic",
    patterns: ["^claude-3-5", "^claude-4"],
    supportsThinking: true,
    supportsTools: true,
  },
  { provider: "openai", patterns: ["^o1", "^o3"], supportsThinking: true, supportsTools: false },
  {
    provider: "openrouter",
    patterns: ["^openrouter/", "^anthropic/"],
    supportsThinking: false,
    supportsTools: true,
  },
  { provider: "opencode", patterns: ["^opencode/"], supportsThinking: false, supportsTools: true },
  { provider: "ollama", patterns: [".*"], supportsThinking: false, supportsTools: true },
];
```

### Key Components

1. **Centralized Registry** (`src/providers/model-registry.ts`): Single source of truth for model detection
2. **Gateway Providers**: OpenRouter and OpenCode Zen providers that extend OpenAIProvider (OpenAI-compatible APIs)
3. **Runtime Configuration**: Agent accepts `RuntimeConfig` parameter for per-request model/thinking overrides
4. **Fuzzy Chat Commands**: CLI commands `/model`, `/thinking`, `/effort` with fuzzy matching using Levenshtein distance

### Provider Detection Order

1. Explicit `provider` in config/CLI (highest priority)
2. Model registry pattern matching
3. Ollama as fallback (catch-all)

## Consequences

**Positive:**

- Single source of truth eliminates duplicate code
- Easy to add new models via registry configuration
- Runtime model/mode switching enables flexible conversations
- Gateway providers (OpenRouter, OpenCode) access curated model collections
- Fuzzy command matching improves UX (e.g., `/m` → `/model`)

**Negative:**

- New module (`model-registry.ts`) to maintain
- Registry must be updated for new model families
- Regex patterns may need tuning for edge cases
- Fuzzy matching adds small complexity to command parsing

## Alternatives Considered

1. **Keep Status Quo**: Prefix-based detection in multiple locations
   - Rejected: Duplicate code, fails for new models, no runtime switching

2. **API-based Detection Only**: Query provider APIs for model info
   - Rejected: Slow, requires network, cannot work without API access

3. **User Config File Only**: Users define all models in config
   - Rejected: High maintenance burden, poor out-of-box experience

## Related Decisions

- **ADR-002**: LLM Provider Abstraction - This enhances the detection mechanism while maintaining the abstraction layer
- **ADR-006**: Plugin System - Model registry could be extended to support plugin-registered models
