# ADR-018: Deferred Tool Discovery — Loading Tools on Demand

**Status:** Draft (design exploration — not yet implemented)
**Date:** 2026-07-31
**Deciders:** (pending implementation decision)

## Context

Currently, **all tools are loaded upfront** at agent startup and sent to the LLM on every request:

```
Startup:
  fileTools (5 tools)     → ToolRegistry ✓
  bashTool (1 tool)       → ToolRegistry ✓
  searchTools (6 tools)   → ToolRegistry ✓
  webSearchTool (1 tool)  → ToolRegistry ✓
  plugins (N tools)       → ToolRegistry ✓
  MCP servers (M tools)   → ToolRegistry ✓
                          = 13+ tools total

Every LLM request:
  tools: [read_file, write_file, edit_file, list_directory, delete_file,
          bash, grep, glob, search, web_search, mcp_context7_*, ...]
```

This has several consequences:
- The tool definitions array grows with each MCP server added (~15-25 lines per tool definition)
- The LLM spends attention on irrelevant tools (e.g., `delete_file` when the task is "read a file")
- Every provider call includes the full tool list, even though most iterations only use 1-2 tools

The ByteByteGo article (issue #86, item #4) describes **deferred tool discovery**: expose only core tools upfront, then return specific tools dynamically when the LLM requests them via a `search_tool` tool.

However, this pattern has a fundamental tension with how LLM tool-calling works: the tool definitions must be known at request time — the LLM cannot call a tool it doesn't know exists.

This ADR explores whether deferred tool discovery is worth implementing for this codebase and proposes an alternative: **tool categorization**, where tools are grouped by purpose and presented selectively based on the task context.

## Research

### How OpenAI's Codex does it

The ByteByteGo article describes Codex's approach: instead of sending all 500 MCP tools, Codex exposes a small set of core tools (Shell, Edit, Search Tool). When needed, `search_tool("deployment")` returns specific tools like `DeployToAWS`, `DeployToCloudflare`, `DeployToVercel`. Only then is the selected tool added to the known tool set.

This is a **two-level tool discovery** system:
1. **Level 1 (always available):** generic tools like `read_file`, `write_file`, `bash`, `search`
2. **Level 2 (on-demand):** domain-specific tools that are returned by a `search_tool` meta-tool, then registered and available for subsequent LLM calls

### How this codebase loads tools

The current flow in `setupTools()` (`src/cli/shared.ts`):
1. Register all `fileTools` (5)
2. Register `bashTool` (1)
3. Register all `searchTools` (6)
4. Register `webSearchTool` (1)
5. Load plugins from disk and register (N)
6. For each MCP server, register all its tools (M)

Total: 13+ static tools + N plugins + M MCP tools = potentially 20-100+ tools

These are all registered in `ToolRegistry` before the Agent is created. Every `runStream()` call passes the full tool list to the LLM.

### Current architecture constraints

The `ToolRegistry` is a flat `Map<string, Tool>`. There is no concept of:
- Tool categories or groups
- Tool priority ("core" vs "extended")
- Lazy registration (tools must exist before the Agent starts)
- Dynamic tool discovery (tools can only be registered via `register()` at startup)

The `SkillManager.filterTools()` method can restrict tools by name, but this is a static allowlist — it doesn't help with discovery.

## Proposed Design

### Option A: Tool Categorization (Recommended)

Instead of two-level tool discovery (which requires a meta-tool and changes the LLM loop), implement **tool categorization**: group tools by their domain and include their category in the system prompt, so the LLM can decide which category to use.

**Tool categories:**
```
Core (always included):
  read_file, write_file, edit_file, list_directory, bash, grep, glob

File operations:
  delete_file (destructive — only when explicitly needed)

Web/Search:
  web_search, search

MCP servers (grouped by server):
  mcp_context7_*     - documentation lookup
  mcp_serena_*       - semantic code operations
```

**Implementation:**

1. Add a `category` field to the `Tool` interface:
   ```typescript
   export interface Tool {
     name: string;
     description: string;
     category?: "core" | "file" | "search" | "mcp" | "plugin";
     // ... existing fields
   }
   ```

2. Define a **core tool set** in `setupTools()`:
   ```typescript
   const CORE_TOOLS = new Set(["read_file", "write_file", "edit_file", "list_directory", "bash", "grep", "glob"]);
   ```

3. In `runStream()`, only pass core tools + relevant MCP tools based on the user's query:
   ```typescript
   // Heuristic: if the query mentions "read" or "edit", include file tools
   const relevantCategories = inferCategories(userPrompt);
   const tools = this._toolRegistry.list().filter(
     (t) => CORE_TOOLS.has(t.name) || relevantCategories.has(t.category)
   );
   ```

**Complexity:** Medium — adds categorization to tool definitions but no new LLM loop changes.

### Option B: Full Deferred Discovery (Reference Design)

Implement the ByteByteGo two-level pattern:

1. **Add a `search_tool` meta-tool** that searches registered tools by keyword and returns matching tool definitions:
   ```typescript
   const searchTool: Tool = {
     name: "search_tool",
     description: "Search for available tools by keyword. Returns tool names and descriptions.",
     execute: async (args) => {
       const results = registry.search(args.keyword);
       return { success: true, output: results };
     },
   };
   ```

2. **Agent loop modification** in `runStream()`:
   - Always include core tools + `search_tool` in the initial LLM call
   - When the LLM calls `search_tool("deploy")`, return matching tools
   - The LLM then makes a subsequent call with the newly discovered tools
   - Add discovered tools to a `_discoveredTools` set for the session

3. **ToolRegistry enhancement:**
   ```typescript
   search(keyword: string): Tool[] {
     return Array.from(this._tools.values()).filter(
       (t) => t.name.includes(keyword) || t.description.includes(keyword)
     );
   }
   ```

**Complexity:** High — modifies the agent loop, adds a meta-tool, changes how tools are presented to the LLM.

### Option C: Static Grouping via Config (Simplest)

Allow users to group tools in their config file, and only pass the relevant group:

```yaml
toolGroups:
  default: [read_file, write_file, edit_file, list_directory, bash, grep, glob]
  deployment: [bash, glob, read_file]
  web: [web_search, read_file]
```

This is declarative and adds no runtime logic, but requires user configuration.

**Complexity:** Very Low — config-only change.

## Consequences

### For Option A (Tool Categorization — Recommended)

**Positive:**
- Reduces tool array size by ~50% for most requests
- LLM spends less attention on irrelevant tools
- Easy to implement (add category field, filter in `runStream()`)
- No meta-tool or agent loop changes needed
- Backward compatible — all tools still exist, just filtered

**Negative:**
- Category inference from user prompt is heuristic (may mis-categorize)
- Some tools span categories (e.g., `bash` is both core and destructive)
- If the LLM needs a tool from a non-inferred category, it must make an extra iteration
- Category assignment requires human judgment per tool

### For Option B (Full Deferred Discovery)

**Positive:**
- Maximum reduction in tool array size
- Dynamic — LLM controls discovery based on need
- Closer to the ByteByteGo/Codex pattern

**Negative:**
- **Major architecture change** — modifies the agent loop, LLM interaction pattern, and ToolRegistry
- LLM must be smart enough to call `search_tool` at the right time — if it forgets, it's stuck
- Extra iteration(s) per discovery event
- Higher test surface (meta-tool + loop modification + search logic)
- Risk of breaking existing tool-calling behavior
- How to discover MCP server tools? MCP servers are not available at startup if deferred

### For Option C (Static Grouping)

**Positive:**
- Simplest to implement — config-only
- User has full control over tool selection
- No code changes to the agent loop

**Negative:**
- Relies on user configuration — default experience unchanged
- No dynamic adaptation to the task
- Additional surface for user confusion

## Trade-offs

| Aspect | Current (all upfront) | Option A (categorization) | Option B (deferred) |
|--------|-----------------------|--------------------------|---------------------|
| Tool array size | Full (N) | ~7 core + matched | ~7 core only |
| Implementation effort | None | Low (category field + filter) | High (meta-tool + loop changes) |
| LLM adaptation | None | Heuristic by prompt | Dynamic via search_tool |
| Risk of missing tools | None | Moderate (wrong category) | Low (LLM can call search_tool) |
| Backward compatibility | — | ✅ Full | ❌ New meta-tool may confuse |
| Test surface change | — | Low | High |
| MCP tool handling | All upfront | All upfront | ❌ Need lazy MCP connection |

## Recommendations

1. **Implement Option A (Tool Categorization) as the initial step.** It provides the bulk of the benefit (reduced tool array ~50% for most requests) with minimal implementation effort. Category inference from the user prompt is a reasonable heuristic — if the LLM needs a tool outside the inferred category, it will request it in its next tool call, and the second iteration will include the relevant tools.

2. **Defer Option B (Full Deferred Discovery).** The architecture changes are too invasive for the current stage of the codebase. If the tool count grows significantly (e.g., 50+ MCP tools), Option B can be reconsidered.

3. **Option C (Static Grouping)** is complementary to both A and B — a power-user feature that could be added later.

## Implementation Plan (Option A)

### Phase 1: Add category marker to tool definitions

```typescript
// src/tools/types.ts
export interface Tool {
  name: string;
  description: string;
  category?: string;  // "core" | "file" | "search" | "mcp" | "plugin"
  // ... existing fields
}
```

### Phase 2: Define core tools and categorize all tools

```typescript
// src/tools/registry.ts or a new categorization config
const CORE_TOOLS = new Set(["read_file", "write_file", "edit_file", "list_directory", "bash", "grep", "glob"]);
```

### Phase 3: Add filtered tool selection in Agent

```typescript
// src/core/agent.ts runStream()
const effectiveTools = this._toolRegistry.list().filter(
  (t) => CORE_TOOLS.has(t.name) || this._isRelevantTool(t, userPrompt)
);
```

### Phase 4: Implement relevance heuristic

```typescript
// Simple keyword-based inference
function inferToolCategories(prompt: string): Set<string> {
  const categories = new Set<string>();
  if (/search|find|lookup|docs/i.test(prompt)) categories.add("search");
  if (/delete|remove/i.test(prompt)) categories.add("file");
  // ... more heuristics
  return categories;
}
```

## Related Decisions

- **ADR-005: Tool System Design** — the `Tool` interface and `ToolRegistry`. This ADR would add a `category` field to the Tool interface.
- **ADR-011: Multi-Agent System** — the state file and PlanGrammar. Tools are currently shared across agents via a single ToolRegistry. Categorization would be per-agent or per-task.
- **ADR-016: Agent Decomposition** — the extraction of `SkillManager` and `TurnExecutor`. `SkillManager.filterTools()` currently does static filtering; categorization could compose with it.
- **Issue #86, item #3 (Stable Prompt Prefix)** — tool ordering is now deterministic. After categorization, only the core tool subset would be in the prefix, further stabilizing it.

## Future Considerations

- If the LLM loop is redesigned for a "Code Mode" (where the model writes JS programs), deferred tool discovery becomes more natural — the model can write `const myTool = await searchTool("deploy")` inline.
- Tool categorization works well with SkillManager restrictions: if a skill restricts to `[read_file, bash]`, the category filter narrows further.
- An observability metric for "tools passed vs tools used" would help validate the categorization heuristic.
- If MCP servers grow to 10+ servers with 100+ tools, deferred discovery (Option B) becomes the only viable approach.
