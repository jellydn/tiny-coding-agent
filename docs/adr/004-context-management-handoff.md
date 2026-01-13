# ADR-004: Context Management via Handoff/Pickup

**Status:** Accepted  
**Date:** 2026-01-13  
**Deciders:** huynhdung

## Context

LLMs have limited context windows. Long conversations or complex tasks can exceed these limits. Need a strategy to manage context without losing important information.

## Decision

Implement a **handoff/pickup** system instead of automatic truncation or summarization:

### Handoff Command

```bash
tiny-agent handoff [session-name]
```

- Saves current conversation state to `~/.tiny-agent/sessions/{session-name}.json`
- Generates a summary of current context, goals, and progress
- Includes file references, tool outputs, and pending tasks

### Pickup Command

```bash
tiny-agent pickup [session-name]
```

- Loads saved session state
- Injects summary as system context
- Resumes conversation with preserved intent

### Session File Format

```json
{
  "id": "uuid",
  "name": "session-name",
  "createdAt": "2026-01-13T10:00:00Z",
  "updatedAt": "2026-01-13T12:00:00Z",
  "summary": "Working on implementing MCP client...",
  "goals": ["Implement MCP client", "Add tool discovery"],
  "context": {
    "files": ["src/mcp/client.ts"],
    "decisions": ["Using stdio transport first"],
    "pendingTasks": ["Add error handling"]
  },
  "messages": [
    /* trimmed conversation */
  ]
}
```

## Alternatives Considered

1. **Automatic truncation:** Loses context, breaks continuity
2. **Summarization:** LLM-dependent, can lose details
3. **RAG:** Complex, overkill for single-user agent

## Consequences

**Positive:**

- User controls when to save/resume
- No context loss - explicit handoff captures state
- Enables multi-session workflows
- Works across different models/providers

**Negative:**

- Manual intervention required
- Session files can grow large
- User must remember to handoff before context overflow
