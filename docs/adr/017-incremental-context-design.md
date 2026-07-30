# ADR-017: Incremental Context — Send-Only-Delta Pattern for Agent Loop Messages

**Status:** Draft (design exploration — not yet implemented)
**Date:** 2026-07-31
**Deciders:** (pending implementation decision)

## Context

In the current agent loop (`Agent.runStream()`), every iteration sends the **full conversation history** to the LLM provider:

```
Iteration 1: system + user prompt
Iteration 2: system + user prompt + assistant response + tool results
Iteration 3: system + user prompt + assistant response + tool results + assistant response2 + tool results2
...
```

This grows linearly with each iteration. For a 10-iteration session with ~50KB of message history, the cumulative bandwidth cost is ~5.5MB — most of which is resending messages the provider has already seen.

The ByteByteGo article on OpenAI's agent architecture (issue #86, item #2) describes an optimization: **send only the new tool output on each iteration, referencing a previous response ID** for context reconstruction by the server.

This ADR explores whether incremental context (send-only-delta) is worth implementing for this codebase.

## Decision (Provisional)

**Defer implementation.** The send-only-delta pattern provides real bandwidth savings but only benefits OpenAI (the sole provider with a mature `previous_response_id` API). The architecture complexity of adding a second streaming path for one provider, combined with the fact that token billing is unchanged (all prior tokens are still billed as input), makes this a low-priority optimization relative to conversation compaction (which benefits all providers and reduces both bandwidth and billing).

The remainder of this ADR documents the research and design for future reference.

## Research Findings

### OpenAI Responses API (`previous_response_id`)

The most mature implementation. The [Responses API](https://platform.openai.com/docs/guides/responses) (`/v1/responses`) supports a `previous_response_id` parameter:

```json
// Turn 1: Full request
{ "model": "gpt-5.6", "input": "initial prompt", "store": true }

// Turn 2+: Only send new input
{ "model": "gpt-5.6",
  "previous_response_id": "resp_abc123",
  "input": "new tool results...",
  "store": true }
```

Key properties:
- **Bandwidth-only savings.** All prior tokens are still billed as input tokens by the API — the server reconstructs the full context internally.
- **System prompt must be resent.** `previous_response_id` does not carry over top-level instructions.
- **30-day retention.** Server-side response storage is enabled by default.
- **WebSocket support.** Uses connection-local in-memory cache for low-latency continuation.
- **Different endpoint.** Requires `/v1/responses`, not `/v1/chat/completions`. Different request/response format.

### Provider Support Matrix

| Provider | Incremental Context? | Notes |
|----------|-------------------|-------|
| **OpenAI** | ✅ Responses API (`previous_response_id`) | Mature, documented, different endpoint |
| **Anthropic** | ❌ No equivalent | Relies on prompt caching instead |
| **OpenRouter** | ❌ Transparent proxy | Passes through to underlying provider |
| **OpenCode** | ❌ Provider-agnostic proxy | No server-side conversation storage |
| **Z.AI** | ❓Unknown | OpenAI-compatible, unknown if Responses API supported |
| **QwenCloud** | ❓Unknown | OpenAI-compatible, unknown if Responses API supported |
| **Ollama** | ❌ Local inference | No server-side storage |

Only OpenAI has a mature implementation. Anthropic's optimization strategy is **prompt caching** (different mechanism — cache the prefix between requests), not incremental context.

### Bandwidth Savings vs. Token Cost

A critical distinction often missed: **bandwidth savings do not equal billing savings.**

With `previous_response_id`:
- Network payload per iteration: `O(1)` — only new input sent
- API billing per iteration: remains `O(N)` for an N-turn conversation — server reconstructs and bills for all prior tokens
- Annual bill: unchanged
- Per-request latency: improved (less data to transmit)

### Current Architecture (for reference)

The current message flow in `Agent.runStream()`:

```
agent.ts → streamLlmResponse()
  → agent-utils.ts: streamLlmResponse()
    → llmClient.stream({ model, messages, tools })
```

Each iteration sends:
- System prompt (always prepended by `streamLlmResponse`)
- Full conversation history (grows monotonically)
- New tool result messages (appended each turn)
- Tool definitions (always the same, sorted alphabetically)

Total messages grow as: 2 + 2*N for N tool-calling turns (user + assistant + tool result for each iteration).

## Proposed Design

If implemented in the future, the design would be:

### 1. `LLMClient` interface extension

```typescript
export interface ChatOptions {
  // ... existing fields ...
  /** Optional previous response ID for incremental context (provider-specific). */
  previousResponseId?: string;
}
```

### 2. `OpenAIProvider` — dual streaming path

```typescript
// Current path (Chat Completions API):
this._client.chat.completions.create(requestBody, ...)

// New path (Responses API, when previousResponseId is set):
this._client.responses.create({
  model: options.model,
  input: options.messages,  // only new messages
  previous_response_id: options.previousResponseId,
  tools: options.tools,
  store: true,
})
```

Responses API has different tool-call semantics and a different streaming format. The provider class would need a separate stream handler for the Responses API response format.

### 3. `Agent.runStream()` — response ID tracking

```typescript
let lastResponseId: string | undefined;

// In the iteration loop:
if (lastResponseId && providerSupportsResponseId) {
  // Send only tool result messages
  const streamGen = streamLlmResponse({
    ...,
    messages: turnResult.toolResultMessages,  // ONLY new messages
    previousResponseId: lastResponseId,
  });
} else {
  // Send full history (current behavior)
  const streamGen = streamLlmResponse({
    ...,
    messages,  // full history
  });
}
```

### 4. `streamLlmResponse` — pass-through

Pass `previousResponseId` from caller → provider options. No logic change — just a forwarding field.

### 5. `AgentObservability` — track Response API calls

Add a metric for "incremental vs full" requests so we can measure bandwidth savings.

## Conversation Compaction (Recommended Alternative)

An alternative approach that **benefits all providers and reduces both bandwidth AND token billing** is **conversation compaction**: periodically summarize old turns into a condensed form.

**How it works:**
```
Original messages (N turns):
  user: "..."
  assistant: "..."
  tool_result: "..."
  assistant: "..."
  tool_result: "..."
  ... (many turns)

After compaction:
  user: "..."
  system: "(Previous conversation summarized: user asked X, agent ran Y tools, found Z)"
  user: "continue"
```

**Advantages over incremental context:**
- ✅ Reduces **token billing** (fewer input tokens = lower API cost)
- ✅ Benefits **all providers** (OpenAI, Anthropic, Ollama, etc.)
- ✅ No new API endpoint or protocol changes needed
- ✅ Works with the current message format (no `previousResponseId` needed)
- ✅ Reduces latency (less context to process before the first token)

**Trade-offs:**
- ❌ Information loss risk — a bad summary could lose context
- ❌ Extra LLM call to generate the summary (offset by savings)
- ❌ More complex than incremental context (needs compaction trigger logic)
- ❌ When to compact? Every N turns? When approaching context limit?

**Recommended trigger:**
- Compact when `total tokens > contextWindow * 0.75` (approaching limit)
- Or compact when `iteration count > 10` (long-running session)
- Or both (whichever comes first)

## Consequences

### If Incremental Context is implemented

**Positive:**
- ~90% bandwidth reduction for long agent sessions on OpenAI
- Faster per-request latency (smaller payloads)
- Aligns with OpenAI's recommended architecture pattern

**Negative:**
- Adds a second streaming code path in `OpenAIProvider` (Responses API vs Chat Completions)
- Two different message formats to manage (full vs incremental)
- Different tool-call semantics in Responses API
- Only benefits OpenAI (and possibly Z.AI/QwenCloud)
- Token billing unchanged — no cost savings
- Testing complexity doubles (need to test both paths)

### If Conversation Compaction is implemented instead

**Positive:**
- Reduces actual token billing — lower API costs
- Benefits all providers equally
- No new API endpoint or protocol changes
- Works with existing message format
- More composable with other optimizations (stable prompt prefix, prompt caching)

**Negative:**
- Information loss from summarization
- Extra LLM call for compaction
- More complex trigger logic
- Summary quality depends on model capability

## Alternatives Considered

1. **Incremental context via OpenAI Responses API.** Documented above. Deferred due to single-provider benefit.

2. **Conversation compaction (summarize old turns).** Recommended alternative. Could be implemented in `context-budget.ts` alongside the existing truncation logic.

3. **Do nothing.** Current behavior is correct and functional. The bandwidth cost of resending messages is negligible for typical sessions (5-10 iterations, <100KB). Only 50+ iteration sessions would see meaningful benefit — a rare edge case.

4. **Hybrid: incremental context for OpenAI, compaction for others.** Would require maintaining both streaming paths and both compaction mechanisms. Not worth the complexity until one approach is proven.

## Related Decisions

- **ADR-004: Context Management (Handoff)** — the context budgeting logic that decides what to keep vs. discard.
- **ADR-008: Memory System** — persistent memory retrieval, which is a different form of context optimization.
- **ADR-016: Agent Decomposition** — the extraction of `context-budget.ts` from `agent.ts`, which is where compaction would live.
- **Issue #86, item #3 (Stable Prompt Prefix)** — already implemented (commit `939207d`). Ensures tool definitions are alphabetically sorted for prompt caching. This optimization benefits all providers and directly reduces token costs.

## Future Considerations

- If OpenAI's Responses API becomes the dominant API surface (replacing Chat Completions), incremental context becomes free — the API already supports `previous_response_id` by default.
- If more providers add `previous_message_id`-style APIs, the cost/benefit shifts and implementation becomes more attractive.
- Conversation compaction could be implemented incrementally: start with the trigger logic, then experiment with summary prompt quality.
- The two optimizations are not mutually exclusive — compaction could reduce Context window pressure while incremental context reduces bandwidth for the remaining messages.
