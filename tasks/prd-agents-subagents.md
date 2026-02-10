# PRD: Agents & Subagents System for Tiny Coding Agent

## Introduction

Implement a multi-agent system for `tiny-coding-agent` where a main dispatcher loop (`tiny-agent`) coordinates specialized, autonomous subagents (`plan-agent`, `build-agent`, `explore-agent`). Each subagent operates independently with a specific purpose, with context shared via a structured JSON state file. Users select which phase to execute via CLI, allowing focused, modular workflows.

## Goals

- Enable modular agent roles (plan, build, explore) that operate independently
- Share context across agents via persistent JSON state file
- Provide CLI interface for users to invoke specific phases
- Each agent has access to full tool suite and can make autonomous decisions
- Support sequential workflows (plan → build → explore) or selective execution

## User Stories

### US-001: CLI dispatcher interface
**Description:** As a user, I want to run specific agent phases from the command line so I can orchestrate the workflow.

**Acceptance Criteria:**
- [ ] `tiny-agent plan [task]` spawns plan-agent with task description
- [ ] `tiny-agent build [task]` spawns build-agent with task description
- [ ] `tiny-agent explore [task]` spawns explore-agent with task description
- [ ] Each command accepts optional `--state-file` flag (default: `.tiny-state.json`)
- [ ] Exit codes reflect success/failure
- [ ] Typecheck/lint passes

### US-002: Shared JSON state file
**Description:** As a subagent, I need to read/write shared context so I can coordinate with other agents.

**Acceptance Criteria:**
- [ ] State file schema includes: phase, taskDescription, status, results, artifacts, errors, metadata
- [ ] All agents can read current state on startup
- [ ] All agents can write results back to state file on completion
- [ ] State file is git-safe (no secrets, human-readable JSON)
- [ ] Concurrent writes don't corrupt state (file locking or transaction pattern)
- [ ] Typecheck/lint passes

### US-003: Plan-agent implementation
**Description:** As a plan-agent, I need to generate actionable plans from task descriptions.

**Acceptance Criteria:**
- [ ] Read task description and context from state file
- [ ] Analyze codebase/requirements using tools (grep, finder, read)
- [ ] Generate structured plan: phases, dependencies, success criteria
- [ ] Write plan to state file under `results.plan`
- [ ] Support `--prd` flag to generate PRD alongside plan
- [ ] Typecheck/lint passes

### US-004: Build-agent implementation
**Description:** As a build-agent, I need to execute plans and create/modify code.

**Acceptance Criteria:**
- [ ] Read plan from state file
- [ ] Execute build steps autonomously (create/edit files, run tests)
- [ ] Update state file with progress after each major step
- [ ] Write build artifacts and errors to state file
- [ ] Support `--dry-run` flag to preview changes without executing
- [ ] Typecheck/lint passes

### US-005: Explore-agent implementation
**Description:** As an explore-agent, I need to analyze codebases and surface insights.

**Acceptance Criteria:**
- [ ] Read task/plan from state file
- [ ] Perform code analysis (file structure, dependencies, patterns)
- [ ] Generate exploration report with findings, recommendations
- [ ] Write findings to state file under `results.exploration`
- [ ] Support `--depth` flag for shallow vs. deep analysis
- [ ] Typecheck/lint passes

### US-006: Agent composition workflows
**Description:** As a power user, I want to chain agents in sequence so I can execute full workflows.

**Acceptance Criteria:**
- [ ] `tiny-agent run-plan-build [task]` executes plan → build in sequence
- [ ] State file carries context between phases automatically
- [ ] If plan-agent fails, build-agent doesn't start (early exit)
- [ ] Results from all phases available in final state file
- [ ] User sees clear phase transitions in output
- [ ] Typecheck/lint passes

## Functional Requirements

- **FR-1:** Main `tiny-agent` CLI accepts subcommands: `plan`, `build`, `explore`, `run-plan-build`, `run-all`
- **FR-2:** Each subcommand accepts task description as positional argument or stdin
- **FR-3:** Global `--state-file` flag controls where state is persisted (default: `.tiny-state.json`)
- **FR-4:** State file is initialized with phase, task, timestamp, agent version, parameters on agent startup
- **FR-5:** Plan-agent outputs numbered phases with dependencies and success criteria
- **FR-6:** Build-agent reads plan, executes steps, asks for confirmation before major steps (file creation, deletion, refactoring)
- **FR-7:** Build-agent stops and prompts user if error occurs; user can retry, skip, or abort
- **FR-8:** Explore-agent performs read-only codebase analysis and outputs structured findings (no code modifications)
- **FR-9:** All agents support `--verbose` flag for detailed logging
- **FR-10:** State file mutations are atomic (write-then-rename or equivalent)
- **FR-11:** State file rotates to `.tiny-state.1.json`, `.tiny-state.2.json` when size exceeds 10MB (configurable)
- **FR-12:** Build-agent respects `.gitignore` and doesn't create artifacts in ignored dirs
- **FR-13:** State file includes metadata section: agent name, version, invocation timestamp, parameters used

## Non-Goals

- Real-time communication between agents (async via state file only)
- Web UI or dashboard for monitoring agents
- Agent-to-agent direct RPC or message passing
- Multi-codebase orchestration (single repo per invocation)
- Rollback/undo functionality for build-agent changes
- Agent scheduling or time-based execution

## Design Considerations

- **State File Schema:** Keep it flat and human-readable; nest only when logical; include metadata section with agent info
- **Error Handling:** Each agent catches and logs errors; state file includes error context; build-agent halts and prompts on error
- **Interactive Confirmation:** Build-agent asks before: file creation, file deletion, large refactors (>50 lines), dependency changes
- **Tool Access:** All agents have same tool access (file, bash, grep, glob, web, etc.); explore-agent has no write access
- **Logging:** Use structured logs (JSON) for machine parsing; human-friendly summary at end
- **Exit Codes:** 0 = success, 1 = agent failure, 2 = invalid args, 3 = state file error, 4 = user declined action
- **State File Rotation:** Log-style rotation keeps history; metadata indicates which file is current/primary

## Technical Considerations

- State file format: JSON (not YAML/TOML) for simplicity
- Each agent is a separate executable (`tiny-plan`, `tiny-build`, `tiny-explore`) or CLI subcommand
- Lock mechanism for state file: File-based locking or atomic writes (research required)
- Agents can be run in parallel with different task files
- Build-agent should minimize changes (dry-run first, then execute with user confirmation in interactive mode)

## Success Metrics

- Users can plan a feature with `tiny-agent plan "add user auth"`
- Users can build off that plan with `tiny-agent build --state-file .tiny-state.json`
- State file accurately reflects progress and can be inspected at any point
- End-to-end workflow (plan → build → explore) completes without manual intervention
- No lost context between agent invocations

## Decisions (Resolved Open Questions)

- **Interactive Mode:** Agents ask for confirmation before major steps (KISS principle)
- **Build Failures:** Stop execution and ask user before continuing
- **State File Metadata:** Include agent versions, parameters, timestamps for reproducibility
- **State File Rotation:** Implement log-style rotation when size exceeds limit (default: 10MB)
- **Explore-Agent Scope:** Read-only; generates reports only, no code modifications

---

## Implementation Order

1. **Phase 1:** State file schema + plan-agent (minimal, no external dependencies)
2. **Phase 2:** CLI dispatcher + build-agent (test with real codebase changes)
3. **Phase 3:** Explore-agent + composition workflows
4. **Phase 4:** Error handling, locking, edge cases
