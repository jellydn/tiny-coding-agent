# ADR-019: Code Mode — LLM-Written Programs for Parallel Tool Execution

**Status:** Draft (design exploration — not yet implemented)
**Date:** 2026-07-31
**Deciders:** (pending implementation decision)

## Context

The current agent loop follows a strict **serial request → respond → execute → repeat** pattern:

```
LLM request (tool list + messages)
  → LLM responds with 1-N tool calls
  → Run tool calls sequentially (batch)
  → Append results as messages
  → LLM request again (with all history)
  → ... repeat up to 20 iterations
```

This has three structural inefficiencies, identified in the ByteByteGo article (issue #86, item #4):

1. **Sequential tool execution**: Even independent tool calls (e.g., `grep` + `glob` + `read_file`) run one at a time because each LLM iteration produces a set of calls that are executed, then the results are fed back for the next decision.

2. **Context growth per iteration**: Each iteration adds tool call JSON + result text to the message array. After 5-10 iterations, the context is dominated by tool results rather than the actual reasoning.

3. **LLM overhead per decision**: The LLM makes a round-trip for every decision point. If the task requires 8 tool calls, that's 8 LLM requests (or at best 3-4 if batching multiple calls per iteration).

The ByteByteGo article describes **Code Mode** as an alternative: instead of the LLM making tool calls one iteration at a time, the LLM writes a JavaScript program that the harness executes in one shot.

```
Current:   LLM → tool call → result → LLM → tool call → result → LLM → answer
Code Mode: LLM → [JS program with 8 tool calls] → harness executes → answer
```

This ADR explores whether Code Mode is worth implementing for this codebase, what design would work best given the current architecture, and how to phase the implementation.

## Research

### How OpenAI's Codex does Code Mode

The ByteByteGo article describes Codex's approach at a high level: the model writes a JavaScript program using `await` for async tool calls, including `Promise.all()` for parallel execution. The harness (the host process) executes this program and returns the final result.

Key characteristics:
- **The program is ephemeral**: It runs once, produces a result, and is discarded.
- **Tool access via async functions**: Tools are exposed as async JavaScript functions (e.g., `readFile()`, `search()`, `grep()`).
- **Parallelism via `Promise.all()`**: The model can choose to run independent tool calls in parallel.
- **Single LLM request**: The entire sequence of tool calls is planned in one LLM response, dramatically reducing overhead.

### How this codebase currently executes tools

The current flow in `runStream()` → `TurnExecutor.executeTurn()`:

1. LLM responds with `assistantMessage.toolCalls` (an array of `{ name, arguments }`)
2. `TurnExecutor.executeTurn()` calls `registry.executeBatch(calls)` which runs all calls via `Promise.all()`
3. Results are appended as tool result messages
4. The next LLM iteration sees the results and decides what to do next

This already uses `Promise.all()` for parallel execution within a single turn. The serial bottleneck is the **LLM round-trips between turns**, not the tool execution itself.

### Current architecture constraints

1. **ToolRegistry executes via `executeBatch()`**: Tools are already executed in parallel within a turn. The bottleneck is the LLM iteration cycle.

2. **`agent.ts` runStream() is an async generator**: It yields `AgentStreamChunk` objects as it progresses through iterations. Code Mode would need to fit within this generator model, or replace it for a Code Mode session.

3. **Tool definitions include zod schemas**: Most tools have zod-validated args schemas. A Code Mode program would need to construct valid args for each tool call.

4. **No JavaScript sandbox exists**: Currently, tool execution happens in-process via `ToolRegistry.execute()`. A Code Mode program would need either a sandbox (isolated execution) or the same in-process execution.

## Proposed Design

### Option A: Plan-Ahead Tool Batch (Recommended for v1)

Instead of the LLM writing an executable JavaScript program (complex, high risk), implement a **plan-ahead pattern**: the LLM outputs a structured plan listing multiple tool calls, and the harness executes them in a single turn without intervening LLM requests.

**How it works:**

1. Add a system prompt instruction: "When you need multiple tool calls, output them all at once in a `tool_calls` JSON array. The system will execute them in parallel and return all results together."

2. In `runStream()`, collect all tool calls from a single LLM response, execute them all, and return results to the LLM in **one** iteration — no per-call round-trip.

3. The LLM processes the combined results and either outputs more tool calls or provides the final answer.

**Example flow:**

```
LLM receives: user prompt + system prompt (with Code Mode instructions)
LLM outputs: 
  1. grep for function signature
  2. grep for usages
  3. read_file for both files
  [all three tool calls in one response]

Harness: executes all 3 in parallel via Promise.all()
LLM receives: all 3 results at once
LLM outputs: final answer (synthesized from all results)

Total: 2 LLM requests instead of 4+
```

**Implementation sketch:**

```typescript
// In runStream(), replace the per-iteration loop with a plan-ahead check:
if (assistantToolCalls.length > 0) {
  // Execute all tool calls (already happens via executeBatch)
  // Return all results at once
  messages.push(...toolResultMessages);
  
  // Continue to next iteration — LLM receives all results together
  continue;
}
```

Wait — this is **already how it works**. The LLM can output multiple tool calls in one response, and they're all executed in parallel via `executeBatch()`.

The real optimization in Option A is about **LLM training/prompting** — teaching the LLM to output more tool calls per iteration rather than making many small iterations. This is a prompt engineering change, not an architecture change.

**Complexity:** Very Low — prompt-only change (if the model already supports batch tool calling).

### Option B: Declarative Plan Format (Recommended for v1 — Extended)

Instead of the LLM writing executable JavaScript, it writes a **declarative plan** in a JSON format that the harness interprets. This is the middle ground between prompting and full Code Mode.

**Declarative plan format:**

```json
{
  "plan": [
    { "step": "search", "args": { "pattern": "function foo" } },
    { "step": "grep", "args": { "pattern": "foo\\(", "path": "src/" } },
    { "step": "read_file", "args": { "path": "$results[0].path" } }
  ],
  "parallel_groups": [
    [0, 1],    // search and grep can run in parallel
    [2]        // read_file depends on search result
  ]
}
```

**Benefits over JavaScript:**
- No sandbox needed (JSON is safe to parse)
- No runtime evaluation risk
- Simpler for the LLM to generate (JSON is easier than valid JS)
- Dependency graph is explicit and verifiable
- The harness can validate the plan before executing

**Implementation:**

1. Add a `parseToolPlan()` function that converts the JSON plan into a DAG of tool calls
2. Add a `executeToolPlan()` function that walks the DAG, executing parallel groups
3. Modify `runStream()` to detect declarative plans vs regular tool calls
4. Add system prompt instructions for the plan format

**Example flow:**

```
Iteration 1:
  User: "Refactor function foo to use async"
  LLM: outputs declarative plan (search → grep → read → edit)
  Harness: executes plan (parallel: search+grep, then read, then edit)
  LLM receives: all results
  LLM outputs: final answer

Total: 2 LLM requests (plan + answer) instead of 5+ (search, grep, read, edit, answer)
```

**Complexity:** Medium — new parser + executor + integration with runStream.

### Option C: Full JavaScript Sandbox (Long-term)

Implement a sandboxed JavaScript runtime where the LLM writes and executes arbitrary programs.

**Design:**

1. **Sandbox**: Use `vm` module (Node.js built-in) or isolated-vm for security
2. **API surface**: Expose tools as async functions:
   ```javascript
   async function readFile(path) { ... }
   async function search(pattern) { ... }
   async function grep(pattern, path) { ... }
   ```
3. **Program template**:
   ```javascript
   async function main() {
     const files = await Promise.all([
       grep("function foo", "src/"),
       grep("foo(", "tests/"),
     ]);
     const content = await readFile("src/foo.ts");
     return { files, content };
   }
   ```
4. **Result handling**: The program's return value is returned to the LLM as a tool result
5. **Timeout**: Programs have a max execution time (configurable, default 30s)
6. **Resource limits**: Memory limit, no network access, no filesystem access beyond tool APIs

**Implementation phases:**

1. **Phase 1 — Simple executor**: Run the JS program in a `vm.Script` with a limited context
2. **Phase 2 — Tool API bindings**: Expose tools as async functions in the sandbox
3. **Phase 3 — Result handling**: Parse the program's return value and inject it into the conversation
4. **Phase 4 — Dual mode**: Let the LLM choose between Code Mode (for multi-step tasks) and regular mode (for simple tasks)

**Complexity:** Very High — sandbox + API bindings + executor + safety measures.

## Trade-offs

| Aspect | Current (tool calls) | Option A (prompt-only) | Option B (declarative plan) | Option C (JS sandbox) |
|--------|---------------------|----------------------|----------------------------|----------------------|
| LLM requests per task | N (iterations) | N (same, but LLM batches more) | ~2 (plan + answer) | 1-2 (program + answer) |
| Tool execution | Per-iteration batch | Per-iteration batch | DAG-walked, parallel groups | Program-controlled, fully parallel |
| LLM training needs | None | Strong (model must batch well) | Moderate (plan format) | Low (JS is common training data) |
| Implementation effort | None | Very Low | Medium | Very High |
| Sandbox safety | N/A (in-process) | N/A | N/A | Critical (vm + limits) |
| Backward compatibility | — | ✅ Full | ⚠️ Needs dual-mode parser | ❌ New interaction pattern |
| Error handling | Per-call, simple | Same as current | Plan validation + per-step | Program-level try/catch |
| Test surface change | — | None | New (plan parser + executor) | Massive (sandbox + APIs + programs) |

## Recommendation

**Implement Option B (Declarative Plan Format) as the initial Code Mode implementation.**

Rationale:

1. **No sandbox risk** — JSON parsing is safe; no `vm` or isolated-vm dependency needed.
2. **Parallelism gains** — The DAG walker executes independent steps in parallel, reducing wall-clock time.
3. **Measurable improvement** — A 5-step task today takes ~5 LLM iterations. With declarative plans, it takes ~2 (plan + answer). This is a 60% reduction in LLM calls.
4. **Backward compatible** — Regular tool calls still work. The declarative plan is detected via a special field in the LLM response, so existing behavior is unchanged.
5. **Phased approach** — Option B can be split into phases:
   - **Phase 1**: Parse + execute declarative plans (no dependency tracking yet)
   - **Phase 2**: Add dependency DAG and parallel group execution
   - **Phase 3**: Train/improve prompt to make LLM use the format reliably

**Defer Option C** until the codebase has:
- A proven need (e.g., 10+ MCP servers, 50+ tool requests per task)
- Proven safety patterns from the community (e.g., Codex's implementation details)
- A dedicated security review of the sandbox boundary

## Implementation Plan — Phase 1

### Add `executePlan()` to TurnExecutor

```typescript
// turn-executor.ts
interface PlanStep {
  step: string;      // tool name
  args: Record<string, unknown>;
  deps?: number[];   // indices of steps this step depends on
}

interface DeclarativePlan {
  plan: PlanStep[];
  parallel_groups?: number[][];
}

async executePlan(plan: DeclarativePlan): Promise<TurnResult> {
  const results = new Map<number, ToolResult>();
  
  if (plan.parallel_groups) {
    // DAG-based execution: run each parallel group sequentially,
    // steps within a group in parallel
    for (const group of plan.parallel_groups) {
      const stepResults = await Promise.all(
        group.map(async (idx) => {
          const step = plan.plan[idx];
          const args = resolveDependencies(step.args, results);
          return { idx, result: await this._registry.execute(step.step, args) };
        })
      );
      for (const { idx, result } of stepResults) {
        results.set(idx, result);
      }
    }
  } else {
    // All steps in parallel (no dependency info)
    const allResults = await Promise.all(
      plan.plan.map(async (step, idx) => {
        return { idx, result: await this._registry.execute(step.step, step.args) };
      })
    );
    for (const { idx, result } of allResults) {
      results.set(idx, result);
    }
  }
  
  // Build result messages and display objects
  return buildTurnResult(plan.plan, results);
}
```

### Detect declarative plans in `runStream()`

```typescript
// In runStream(), after parsing LLM response
if (assistantToolCalls.length === 0 && responseHasPlan(responseContent)) {
  const plan = parseToolPlan(responseContent);
  const turnResult = await this._turnExecutor.executePlan(plan);
  // ... yield display objects, append messages
} else {
  const turnResult = await this._turnExecutor.executeTurn(assistantToolCalls);
  // ... existing flow
}
```

### System prompt augmentation

Add instructions for the declarative plan format when Code Mode is enabled:

```typescript
const codeModeInstruction = `
When you need to make multiple tool calls, you can output a declarative plan 
instead of individual tool calls. A plan is a JSON object with a "plan" array:

{
  "plan": [
    { "step": "tool_name", "args": { ... } },
    { "step": "tool_name", "args": { ... } }
  ],
  "parallel_groups": [[0, 1], [2]]
}

Steps within the same parallel_group run simultaneously.
Steps in different groups run sequentially (group 0, then group 1, etc.).
Use this for multi-step tasks to reduce round-trips.
`;
```

### MCP tool categorization enhancement

Code Mode pairs naturally with tool categorization (PR #96). A declarative plan can include categorized tools because they're all registered in the ToolRegistry — just filtered by the heuristic. If a plan references a tool that was filtered out, `executePlan()` should try to register it on demand and retry.

## Consequences

### Positive

- **Fewer LLM round-trips**: A multi-step plan executes in 1 iteration instead of N
- **Parallelism gains**: Independent steps run concurrently via `Promise.all()`
- **Deterministic execution**: The plan is explicit and verifiable before execution
- **Backward compatible**: Regular tool calls continue to work; plan detection is additive
- **Phased rollout**: Can start with simple plans (no dependency tracking) and add complexity later

### Negative

- **LLM reliability**: The LLM must generate valid JSON plans consistently. Schema validation and retry logic will be needed.
- **Plan validation overhead**: Invalid plans (missing tools, bad args) need graceful fallback to regular mode.
- **Dependency resolution**: `$results[0].path` references requires a lightweight expression evaluator.
- **Debugging complexity**: A failing plan is harder to debug than a failing single tool call — the error could be in the plan format, dependency resolution, or tool execution.

### Risks

- **LLM ignores Code Mode**: If the model doesn't use the plan format reliably, the feature provides no benefit. Mitigation: make Code Mode opt-in (per-request), and measure adoption via observability.
- **Plan format limits flexibility**: A declarative plan can only express tool calls, not conditional logic (`if result.error`). Mitigation: Phase 1 handles only linear plans; conditional plans are Phase 2.
- **Sandbox temptation**: Once plans work, there will be pressure to add more expressiveness (conditionals, loops). This slides toward Option C (JS sandbox) by increments. Mitigation: define explicit boundaries for what plans can express; if a feature requires a JS sandbox, it's deferred to Option C.

## Related Decisions

- **ADR-005: Tool System Design** — the `Tool` interface and `ToolRegistry.execute()` used by `executePlan()`.
- **ADR-011: Multi-Agent System** — the state file and PlanGrammar. Declarative plans would be a separate concern from the build/explore agent state.
- **ADR-016: Agent Decomposition** — `TurnExecutor` is the natural home for `executePlan()`. The module already handles tool execution + error recovery; adding plan execution is an extension of its existing responsibility.
- **ADR-018: Deferred Tool Discovery** — tool categorization (PR #96) complements Code Mode: categorized tools are available in plans, and the plan format lets the LLM explicitly request tools it needs.
- **Issue #86, item #4 (Code Mode)** — the originating issue item.

## Future Considerations

- A **visual plan debugger** (showing the DAG, executed steps, timings) would help diagnose plan failures.
- **Plan templates** for common workflows (e.g., "read file → edit file → read file to verify") could be pre-defined and suggested to the LLM.
- **Observability metrics**: `plans_created`, `plans_succeeded`, `plans_failed`, `avg_steps_per_plan` — to validate the feature's impact on LLM round-trip reduction.
- If Option C (JS sandbox) is later implemented, the plan format could serve as a compilation target: the LLM writes JavaScript, which is compiled to a declarative plan for safe execution.
- **Plan caching**: If the same plan structure appears repeatedly (e.g., "find definition → read file"), it could be cached and replayed without an LLM call.
