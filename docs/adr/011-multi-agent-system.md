# ADR-011: Multi-Agent System (Plan/Build/Explore)

## Status

Proposed

## Context

Currently, `tiny-coding-agent` operates as a single monolithic agent loop. As tasks become more complex, we need to decompose work into specialized phases with distinct purposes:

- **Plan Phase**: Analyze requirements and generate structured plans
- **Build Phase**: Execute plans and create/modify code
- **Explore Phase**: Analyze codebases and surface insights

Users need flexibility to invoke specific phases independently or chain them together in workflows. This requires:

1. A shared state mechanism to carry context between phases
2. Independent agent implementations for each purpose
3. A CLI dispatcher to orchestrate agent invocations
4. Interactive confirmation for significant changes (especially in build phase)

## Decision

Implement a multi-agent system with the following architecture:

### 1. Shared State File (`.tiny-state.json`)

A single source of truth for context across all agents:

```json
{
  "metadata": {
    "agentName": "plan-agent|build-agent|explore-agent",
    "agentVersion": "1.0.0",
    "invocationTimestamp": "2025-01-26T14:30:00Z",
    "parameters": {}
  },
  "phase": "plan|build|explore",
  "taskDescription": "user task description",
  "status": "running|success|error",
  "results": {
    "plan": "... plan markdown ...",
    "build": { "filesCreated": [...], "filesModified": [...] },
    "exploration": { "findings": [...], "recommendations": [...] }
  },
  "errors": [],
  "artifacts": {}
}
```

**Properties:**
- **Atomic Writes**: State file mutations use write-then-rename pattern
- **File Locking**: Prevents concurrent corruption (file-based locking)
- **Log Rotation**: Archives to `.1`, `.2` when size > 10MB (configurable)
- **Metadata**: Includes agent version, invocation timestamp, parameters for reproducibility

### 2. Agent Implementations

Three specialized, autonomous agents:

#### Plan-Agent (`src/agents/plan-agent.ts`)
- Reads task description and codebase context
- Generates numbered phases with dependencies and success criteria
- Asks for confirmation before major architectural decisions
- Outputs structured markdown plan
- Optional `--prd` flag to generate PRD alongside plan

#### Build-Agent (`src/agents/build-agent.ts`)
- Reads plan from state file
- Executes build steps sequentially
- **Interactive confirmation** before: file creation, file deletion, refactors >50 lines, dependency changes
- **Error handling**: Stops and prompts user (retry/skip/abort) on error (exit code 4 if declined)
- Updates state file with progress after each step
- Respects `.gitignore`
- Optional `--dry-run` flag to preview changes

#### Explore-Agent (`src/agents/explore-agent.ts`)
- Read-only code analysis (no write access)
- Generates findings: file structure, dependencies, patterns, code metrics
- Supports `--depth` flag: shallow (files) vs. deep (full analysis)
- Outputs structured report

### 3. CLI Dispatcher (`main.tsx`)

```bash
# Single phase execution
tiny-agent plan "task description"
tiny-agent build --state-file .tiny-state.json
tiny-agent explore [task]

# Composition workflows
tiny-agent run-plan-build "task description"
tiny-agent run-all "task description"

# State management
tiny-agent state show [--state-file path]
tiny-agent state clear [--state-file path]
```

**Flags:**
- `--state-file <path>` (default: `.tiny-state.json`)
- `--verbose` for detailed logging
- `--dry-run` (build-agent only)
- `--prd` (plan-agent only)
- `--depth` (explore-agent only: shallow|deep)

**Exit Codes:**
- `0`: Success
- `1`: Agent failure
- `2`: Invalid arguments
- `3`: State file error
- `4`: User declined action

### 4. Interactive Confirmation (KISS Principle)

Build-agent asks for confirmation before major changes:

```
? Create file src/utils/auth.ts? (Y/n)
? This will refactor 120 lines in src/api/handler.ts. Continue? (Y/n)
? Update package.json dependencies? (Y/n)
```

On error:
```
Error: npm install failed with code 1
? Retry | Skip | Abort (r/s/a)
```

### 5. Composition Workflows

**run-plan-build**: Plan → Build (sequential, shared state)
- If plan-agent fails, build-agent doesn't start
- User sees clear phase transitions

**run-all**: Plan → Build → Explore (all three phases)
- Stops at first failure, prompts user to continue
- All results accumulate in final state file

## Consequences

### Advantages

1. **Modularity**: Each agent has a single, well-defined purpose
2. **Reusability**: Agents can be invoked independently or composed
3. **Transparency**: State file is inspectable at any point
4. **Safety**: Interactive confirmation prevents unintended changes
5. **Traceability**: Metadata enables reproducibility and auditing
6. **Context Continuity**: Shared state file carries full context between phases
7. **User Control**: Choose which phases to run; KISS confirmation before major steps

### Disadvantages

1. **Complexity**: More code than single-agent approach
2. **Latency**: Each agent startup has overhead (though minimal)
3. **File I/O**: State file can become large (mitigated by rotation)
4. **No Real-time Sync**: Agents communicate async via state file (acceptable for this use case)

### Tradeoffs

- **Interactive vs. Autonomous**: Agents ask for confirmation on major steps (user friendly, not pure automation)
- **Single File vs. Multiple State Files**: Chose single `.tiny-state.json` for simplicity (rotated logs prevent bloat)
- **Agent Processes vs. Functions**: Agents are functions (not separate processes) for simplicity and context sharing

## Related Decisions

- ADR-001: Project Architecture (single agent loop → multi-agent)
- ADR-005: Tool System Design (agents use same tools)
- ADR-008: Memory System (state file is separate from memory)

## Future Considerations

- [ ] Agent scheduling or time-based execution
- [ ] Real-time agent monitoring dashboard
- [ ] Parallel agent execution (with state merging)
- [ ] Multi-codebase orchestration
- [ ] Rollback/undo for build-agent changes
