# PRD: Status Line

## Introduction

Add a persistent status line at the bottom of the terminal that displays real-time information about the agent's state. This includes context/token usage, current model, active tool calls, and agent status. The feature improves transparency, aids debugging, and keeps users informed about resource consumption.

## Goals

- Display context usage (tokens used/remaining) in real-time
- Show current model name and provider
- Indicate active tool being called
- Show agent status (thinking, idle, error)
- Provide a non-intrusive, always-visible footer

## User Stories

### US-001: Create status line renderer

**Description:** As a developer, I need a status line component that can render at the bottom of the terminal so other components can update it.

**Acceptance Criteria:**

- [x] Create `StatusLine` class in `src/cli/status-line.ts`
- [x] Renders a single line at terminal bottom using ANSI escape codes
- [x] Supports update without scrolling main content
- [x] Clears status line on exit
- [x] Typecheck passes

---

### US-002: Display context/token usage

**Description:** As a user, I want to see how many tokens I've used so I know when I'm approaching limits.

**Acceptance Criteria:**

- [ ] Shows tokens used / max tokens (e.g., "Ctx: 12.5k/128k")
- [ ] Updates after each message exchange
- [ ] Uses compact number formatting (k for thousands)
- [ ] Typecheck passes

### US-003: Display current model

**Description:** As a user, I want to see which model is active so I know what I'm working with.

**Acceptance Criteria:**

- [ ] Shows provider and model (e.g., "anthropic:claude-3-5-sonnet")
- [ ] Truncates long model names if needed
- [ ] Updates when model changes
- [ ] Typecheck passes

### US-004: Display active tool call

**Description:** As a user, I want to see which tool is being called so I understand what the agent is doing.

**Acceptance Criteria:**

- [ ] Shows tool name when a tool is executing (e.g., "⚙ read_file")
- [ ] Shows elapsed time for long-running calls (e.g., "⚙ read_file 3.2s")
- [ ] Clears when tool completes
- [ ] Shows nothing when no tool is active
- [ ] Typecheck passes

### US-005: Display agent status

**Description:** As a user, I want to see the agent's current state (thinking, idle, error).

**Acceptance Criteria:**

- [ ] Shows status indicator: "⏳ Thinking", "✓ Ready", "✗ Error"
- [ ] Colorized: green for ready, yellow for thinking, red for error
- [ ] Updates in real-time as state changes
- [ ] Error status shows briefly before returning to ready
- [ ] Typecheck passes

### US-006: Integrate status line with agent loop

**Description:** As a developer, I need the agent loop to update the status line with current state.

**Acceptance Criteria:**

- [ ] Agent loop updates status on state changes
- [ ] Tool executor updates status on tool start/end
- [ ] Token tracker updates context display
- [ ] Status line disabled in non-TTY environments
- [ ] Typecheck passes

### US-007: Add --no-status flag

**Description:** As a user, I want to disable the status line if I prefer a cleaner output.

**Acceptance Criteria:**

- [ ] Add `--no-status` CLI flag
- [ ] Status line hidden when flag is set
- [ ] Default behavior shows status line
- [ ] Typecheck passes

## Functional Requirements

- FR-1: Status line renders at terminal bottom row, fixed position
- FR-2: Status line updates in-place without causing scroll
- FR-3: Display format: `[Status] | Model: provider:model | Ctx: used/max | Tool: name`
- FR-4: Status shows: ⏳ Thinking (yellow), ✓ Ready (green), ✗ Error (red)
- FR-5: Context shows compact format (e.g., 12.5k/128k)
- FR-6: Tool section shows name + elapsed time during active execution (e.g., "⚙ read_file 3.2s")
- FR-7: Status line gracefully degrades in non-TTY environments (hidden)
- FR-8: Status line cleans up on process exit (restores cursor, clears line)

## Non-Goals

- No persistent history of status changes
- No configuration for status line position (always bottom)
- No custom color themes for status line
- No multi-line status display

## Technical Considerations

- Use ANSI escape codes for cursor positioning (`\x1b[s`, `\x1b[u`, `\x1b[?25l`)
- Check `process.stdout.isTTY` before rendering
- Use `process.stdout.rows` to determine bottom position
- Handle terminal resize events (`process.stdout.on('resize')`)
- Integrate with existing token tracking in `src/core/tokens.ts`

## Success Metrics

- Status line updates within 100ms of state changes
- No visual flicker during updates
- Zero impact on non-TTY environments (piped output)
- Users can identify agent state at a glance

## Open Questions

None - all questions resolved.
