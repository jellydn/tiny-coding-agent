# ADR-008: Memory System Architecture - User-Initiated Storage with LLM Retrieval

**Status:** Accepted
**Date:** 2026-01-17
**Deciders:** huynhdung

## Context

The agent needs a memory system to persist important information across sessions. Key considerations:

- How should memories be stored and retrieved?
- Should the LLM auto-save memories or require user initiative?
- How to handle memory token limits and relevance filtering?

## Decision

We implemented a **user-initiated storage** + **LLM-retrieval** pattern:

1. **Memory Storage**: Manual only via `memory add` command
   - User controls what gets persisted
   - Categories: `user`, `project`, `codebase`
   - Automatic LRU eviction at `maxMemories` (default: 100)

2. **Memory Retrieval**: Automatic relevance-based
   - Keyword scoring with category multipliers (`project`: 1.5x, `codebase`: 1.2x)
   - Access frequency boost via `log(accessCount + 1) * 2`
   - Token budget: 20% of available context after system prompt

3. **Context Budget Allocation**:
   ```
   maxContextTokens = systemPrompt + memoryBudget(20%) + conversationBudget(remaining)
   ```

## Consequences

**Positive:**

- **User control**: Prevents LLM from storing noise, hallucinations, or irrelevant info
- **Predictable**: Token usage bounded, no surprise context inflation
- **Simple**: Clear mental model - user adds, LLM retrieves
- **Relevance scoring**: Frequently accessed + category-weighted memories surface first

**Negative:**

- **Manual overhead**: User must explicitly add preferences
- **No auto-learning**: LLM cannot organically discover and save patterns
- **Keyword-only matching**: No semantic/RAG similarity (could be added later)

## Session vs Persistent Memory

| Type       | Scope             | Storage                            | Lifetime        |
| ---------- | ----------------- | ---------------------------------- | --------------- |
| Session    | Current chat only | In-memory `_conversationHistory`   | Until chat ends |
| Persistent | Across sessions   | File `~/.tiny-agent/memories.json` | Until evicted   |

## Alternative Considered

**Auto-save by LLM** (rejected for now):

- Would require a `save_memory` tool + system prompt directive
- Risk: storing irrelevant/hallucinated memories
- Can be added as future enhancement if user requests

## Related Decisions

- **ADR-002**: LLM Provider Abstraction - Memory integrates with the provider-agnostic agent loop
- **ADR-004**: Context Management - Memory budget is part of the overall context allocation strategy
