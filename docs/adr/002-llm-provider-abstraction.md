# ADR-002: LLM Provider Abstraction

**Status:** Accepted  
**Date:** 2026-01-13  
**Deciders:** huynhdung

## Context

The agent must support multiple LLM providers (OpenAI, Anthropic, Ollama, local models) without coupling the core logic to any specific provider.

## Decision

Implement a unified `LLMClient` interface that all providers implement:

```typescript
interface LLMClient {
  chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>;
  stream(messages: Message[], options?: ChatOptions): AsyncIterable<StreamChunk>;
}

interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: Tool[];
  stopSequences?: string[];
}

interface ChatResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: { inputTokens: number; outputTokens: number };
  finishReason: "stop" | "tool_calls" | "length";
}
```

### Provider Detection

1. Explicit `provider` in config takes precedence
2. Model name prefix detection (e.g., `claude-*` → Anthropic, `gpt-*` → OpenAI)
3. Fallback to OpenAI-compatible API

## Consequences

**Positive:**

- Swapping providers requires only config change
- Core agent logic is provider-agnostic
- Easy to add new providers

**Negative:**

- Must maintain parity across provider implementations
- Some provider-specific features may be lost in abstraction
