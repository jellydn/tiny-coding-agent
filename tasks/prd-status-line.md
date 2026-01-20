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

### US-001: Create StatusLine Ink component

**Description:** As a developer, I need a StatusLine component that can render at the bottom of the terminal so other components can update it.

**Acceptance Criteria:**

- [x] Create `StatusLine` component in `src/ui/components/StatusLine.tsx`
- [x] Accepts props: status, model, tokensUsed, tokensMax, tool, toolStartTime
- [x] Renders single line with sections separated by ' | '
- [x] Respects terminal width via useStdout
- [x] Typecheck passes

**Status:** ✅ DONE

---

### US-002: Display context/token usage

**Description:** As a user, I want to see how many tokens I've used so I know when I'm approaching limits.

**Acceptance Criteria:**

- [x] Shows tokens used / max tokens (e.g., "Ctx: 12.5k/128k")
- [x] Uses compact number formatting (k for thousands)
- [x] Uses dim color for 'Ctx:' label
- [x] Typecheck passes

**Status:** ✅ DONE

---

### US-003: Display current model

**Description:** As a user, I want to see which model is active so I know what I'm working with.

**Acceptance Criteria:**

- [x] Shows provider and model (e.g., "Model: anthropic:claude-3-5-sonnet")
- [x] Truncates long model names if needed
- [x] Uses dim color for 'Model:' label
- [x] Typecheck passes

**Status:** ✅ DONE

---

### US-004: Display active tool call with elapsed time

**Description:** As a user, I want to see which tool is being called and how long it's taking.

**Acceptance Criteria:**

- [x] Shows tool name when a tool is executing (e.g., "⚙ read_file")
- [x] Shows elapsed time (e.g., "⚙ read_file 3.2s")
- [x] Elapsed time updates every 100ms
- [x] Tool section hidden when no tool is active
- [x] Uses cyan color for tool name
- [x] Typecheck passes

**Status:** ✅ DONE

---

### US-005: Display agent status with colors

**Description:** As a user, I want to see the agent's current state with color coding.

**Acceptance Criteria:**

- [x] Shows status indicator: "⏳ Thinking", "✓ Ready", "✗ Error"
- [x] Colorized: green for ready, yellow for thinking, red for error
- [x] Status is first section in status line
- [x] Typecheck passes

**Status:** ✅ DONE

---

### US-005b: Create StatusLineProvider context

**Description:** As a developer, I need a React context to update status line state from anywhere.

**Acceptance Criteria:**

- [x] Create `src/ui/contexts/StatusLineContext.tsx`
- [x] Provide setStatus, setModel, setContext, setTool, clearTool functions
- [x] useStatusLine hook for consuming components
- [x] Export from src/ui/index.ts
- [x] Typecheck passes

**Status:** ✅ DONE

---

### US-005c: Integrate StatusLine into App

**Description:** As a user, I want the status line to appear at the bottom of the terminal.

**Acceptance Criteria:**

- [x] Wrap App content with StatusLineProvider
- [x] StatusLine component renders at bottom of App
- [x] Status line hidden when shouldUseInk() returns false
- [x] Typecheck passes

**Status:** ✅ DONE

### US-006: Integrate status line with agent loop

**Description:** As a developer, I need the agent loop to update the status line with current state.

**Acceptance Criteria:**

- [x] Agent loop updates status on state changes (setStatus 'thinking'/'ready'/'error')
- [x] Tool executor updates status on tool start/end (setTool/clearTool)
- [x] Token tracker updates context display (setContext)
- [x] Status line disabled in non-TTY environments (via shouldUseInk)
- [x] Typecheck passes

**Status:** ✅ DONE

---

### US-007: Add --no-status flag

**Description:** As a user, I want to disable the status line if I prefer a cleaner output.

**Acceptance Criteria:**

- [x] Add `--no-status` CLI flag
- [x] Status line hidden when flag is set
- [x] Default behavior shows status line
- [x] Typecheck passes

**Status:** ✅ DONE

**Status:** ✅ DONE

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
