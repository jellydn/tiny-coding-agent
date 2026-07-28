# ADR-015: Lifecycle Hooks System

**Status:** Accepted
**Date:** 2026-07-28
**Deciders:** huynhdung

## Context

The tiny-coding-agent has three lifecycle phases where a human-in-the-loop review step is valuable:

1. **After plan generation** (`post-plan-generate`) — the plan is Markdown text that a user may want to review, edit, or reject before it's saved to the state file.
2. **Before build execution** (`pre-build-execute`) — the plan is loaded and parsed into steps; a user may want a final review before any file mutations occur.
3. **After explore completion** (`post-explore-complete`) — the findings report could be annotated or filtered before it's persisted.

The [plannotator](https://github.com/backnotprop/plannotator) tool provides a browser-based UI for reviewing plans visually. Integrating it required a general mechanism for external commands to intercept the agent's lifecycle — not a hardcoded plannotator call.

Three design decisions in the resulting implementation are non-obvious enough to warrant an ADR.

## Decisions

### 1. External command spawning (not in-process plugins)

Hooks are **external CLI commands** spawned via `child_process.spawn()`, not in-process JavaScript plugins:

```typescript
// src/hooks/manager.ts — executeHook()
child = spawn(hook.command, finalArgs, {
  env,
  stdio: ["pipe", "pipe", "pipe"],
});
```

The hook receives content via **stdin** (pipe) and returns modified content via **stdout**. Feedback and approval signals travel via **stderr**.

**Rationale:** In-process plugins would require a plugin loading mechanism (dynamic imports, sandboxing, API versioning), which is significant infrastructure for a feature whose primary use case is "open a browser UI, wait for human review." External commands are language-agnostic — plannotator is a Node CLI, but a hook could be a shell script, a Python tool, or a Go binary. The `isCommandAvailable()` check + graceful skip means missing binaries degrade to "no hooks," not a crash. This mirrors the Unix pipe philosophy: small tools that read stdin and write stdout.

### 2. Three lifecycle events with a registry + sequential execution

Hooks are registered in a `HookRegistry` (a `Record<HookEvent, HookConfig[]>`) and executed **sequentially** for each event — each hook receives the output of the previous one:

```typescript
// src/hooks/manager.ts — runHooks()
for (const hook of hooks) {
  const result = await executeHook(hook, { ...input, content: currentContent });
  if (result.modifiedContent && hook.applyModifications !== false) {
    currentContent = result.modifiedContent;
  }
  if (result.approved === false) {
    allApproved = false;
  }
}
```

**Rationale:** Sequential execution (not parallel) because hooks may **modify** content — each hook sees the previous hook's output. This is a transform pipeline, not a fan-out. Three events (not more) cover the human-in-the-loop points without over-instrumenting the agent loop. Adding a new event is a one-line change to `HookEvent` + `emptyHookRegistry()`, but each new event is a maintenance commitment (every caller must handle it).

### 3. Plannotator as a built-in preset (not hardcoded integration)

Plannotator is shipped as a **preset** — a `HookPreset` object that installs two `HookConfig` entries via `tiny-agent hooks install plannotator`:

```typescript
// src/hooks/presets.ts
export const PLANNOTATOR_PRESET: HookPreset = {
  id: "plannotator",
  hooks: [
    { name: "plannotator-review-plan", event: "post-plan-generate", command: "plannotator", ... enabled: true },
    { name: "plannotator-review-build", event: "pre-build-execute", command: "plannotator", ... enabled: false },
  ],
};
```

The plan-review hook is **enabled by default**; the build-review hook is **disabled by default** (double review is opt-in).

**Rationale:** Hardcoding plannotator calls into `planAgent()` and `buildAgent()` would couple the agent to a specific external tool. The preset pattern keeps the agent code generic (it calls `runHooks()`, not `runPlannotator()`) while making plannotator a one-command install. The `BUILTIN_PRESETS` array + `findPreset()` function makes adding future presets (e.g. a Slack-approval hook, a PR-comment hook) a new preset file, not an agent code change.

## Consequences

### Positive

- **Language-agnostic extensibility:** any tool that reads stdin and writes stdout can be a hook — no plugin SDK, no dynamic imports, no sandboxing.
- **Agent code stays clean:** `planAgent()` and `buildAgent()` call `runHooks(registry, "post-plan-generate", input)` — one line, no plannotator-specific logic.
- **Graceful degradation:** if the `plannotator` binary isn't installed, the hook is skipped (not an error). The agent continues without review.
- **Preset install is one command:** `tiny-agent hooks install plannotator` writes the hook configs to `config.yaml`. No manual YAML editing.
- **Review from chat mode:** the `/review` chat command loads hooks from config, runs `post-plan-generate` hooks on the current plan, and saves the modified plan back to the state file — all without exiting the chat session.

### Negative

- **No timeout by default:** `timeoutMs: 0` means a review hook can block indefinitely. This is intentional (human review takes as long as it takes), but a stuck hook with no timeout and no signal handling could hang the agent. A future hardening could add a configurable default timeout with a "still waiting?" prompt.
- **Approval detection is naive:** the manager checks for `"REJECTED"` in stderr to set `approved: false`. This is a plannotator-specific convention, not a general protocol. A more robust approach would be a structured output format (e.g. JSON on stdout with `{ approved: bool, content: string }`).
- **Sequential hooks can't run in parallel:** if two hooks both listen to `post-plan-generate`, they run one after the other. For independent review tools, this is unnecessarily slow. Parallel execution would require merging modified content (conflict resolution), which adds complexity for no current use case.
- **Content size limits:** content is piped via stdin as a single write. Very large plans (> 1MB) could hit Node.js stream buffering limits. No chunked streaming is implemented.

### Trade-offs

- **External commands vs. in-process plugins:** chose external for language-agnostic extensibility and zero sandboxing needs. The cost is no direct memory access to the agent's state — hooks work with text, not objects.
- **Sequential vs. parallel execution:** chose sequential for content modification chains. The cost is slower multi-hook execution. No current use case has multiple hooks on the same event.
- **Preset vs. hardcoded:** chose preset for decoupling. The cost is the `hooks install` step — a hardcoded integration would work out of the box, but at the price of agent-level coupling.

## Alternatives Considered

1. **In-process plugin system (dynamic imports).** Rejected — requires a plugin SDK, API versioning, and sandboxing. The primary use case (plannotator) is an external CLI tool, not a JS module. The external-command pattern is simpler and more flexible.
2. **Webhook-based hooks (HTTP instead of spawn).** Rejected — requires a running server, network configuration, and a port. Spawning a local process is zero-config and works offline.
3. **Hardcoded plannotator calls in `planAgent()` and `buildAgent()`.** Rejected — couples the agent to a specific tool. Any future review tool would require agent code changes. The generic `runHooks()` call + preset pattern keeps the agent tool-agnostic.
4. **Structured JSON output protocol instead of stdout/stderr convention.** Deferred — the current stdout=content / stderr=feedback / "REJECTED" convention works for plannotator. A JSON protocol (`{ approved, content, feedback }` on stdout) would be more robust but requires all hook tools to implement it. Could be added as an optional `outputFormat: "json"` field on `HookConfig`.
5. **Event emitter pattern (EventEmitter.emit) instead of explicit runHooks() calls.** Rejected — event emitters are async-by-convention but the agent needs to `await` the hook result before proceeding. Explicit `runHooks()` calls with `await` make the blocking semantics clear.

## Implementation

See files:

- `src/hooks/types.ts` — `HookEvent`, `HookConfig`, `HookInput`, `HookResult`, `HookPreset`, `HookRegistry`, `emptyHookRegistry()`.
- `src/hooks/manager.ts` — `buildRegistry()`, `hasHooks()`, `executeHook()` (spawn + stdin/stdout), `runHooks()` (sequential pipeline).
- `src/hooks/presets.ts` — `PLANNOTATOR_PRESET`, `BUILTIN_PRESETS`, `findPreset()`, `listPresetIds()`.
- `src/hooks/index.ts` — barrel export.
- `src/config/schema.ts` — `hooks?: HookConfig[]` field on `Config` + validation.
- `src/agents/plan-agent.ts` — `runHooks(registry, "post-plan-generate", ...)` call after plan generation.
- `src/agents/build-agent.ts` — `runHooks(registry, "pre-build-execute", ...)` call before build execution.
- `src/cli/handlers/hooks.ts` — CLI handler: `list`, `presets`, `install`, `enable`, `disable`, `remove`.
- `src/cli/handlers/review.ts` — CLI handler: `tiny-agent review` triggers hooks on the current plan.
- `src/cli/command-dispatch.ts` — registers `hooks` and `review` commands.
- `src/cli/chat-commands.ts` — `/review` chat command parser.
- `src/ui/hooks/useCommandHandler.ts` — `/review` chat command handler (loads hooks, runs them, saves modified plan).
- `src/ui/components/CommandMenu.tsx` — `/review` entry in the command picker.
- `test/hooks/manager.test.ts` — 9 tests (registry, execution, stdin piping, error handling).
- `test/hooks/presets.test.ts` — 16 tests (plannotator preset structure, findPreset, listPresetIds).
- `test/hooks/types.test.ts` — 3 tests (emptyHookRegistry structure).
- `test/hooks/chat-commands.test.ts` — 5 tests (`/review` command parsing).

## Related Decisions

- **ADR-005: Tool System Design** — the tool interface and registry. Hooks are a separate concept from tools: tools are called by the LLM during the agent loop; hooks are called by the agent at lifecycle boundaries. Both use a registry pattern, but hooks spawn external commands while tools are in-process functions.
- **ADR-006: Plugin System** — the plugin loader for custom tools. Hooks are complementary: plugins extend the tool set, hooks extend the lifecycle. Both are config-driven and discoverable.
- **ADR-011: Multi-Agent System** — the state file and PlanGrammar. The `post-plan-generate` hook fires after `planAgent()` generates a plan but before it's saved to the state file — the hook can modify the plan text that gets persisted.

## Future Considerations

- A `outputFormat: "json"` option on `HookConfig` for structured hook output (`{ approved, content, feedback }`), replacing the stdout/stderr convention.
- A `post-tool-execute` event for hooks that review individual tool results (e.g. a security scanner that reviews bash command output).
- Parallel hook execution for independent hooks on the same event (requires conflict resolution for modified content).
- A `--timeout` flag on `tiny-agent hooks install` to set a default timeout for review hooks.
- Integration with the Langfuse observability system — hook executions should emit spans for trace visibility.
