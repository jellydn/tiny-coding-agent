# ADR-010: Ink CLI Integration

**Status:** Accepted  
**Date:** 2026-01-18  
**Deciders:** huynhdung

## Context

The tiny coding agent needed better terminal UI for:

- Visual feedback during LLM API calls (spinners)
- Styled message formatting (user vs assistant distinction)
- Structured tool output display with borders and status icons
- Scrollable views for long tool outputs
- Programmatic JSON output for integration with other tools

The existing `console.log` and `process.stdout.write` approach was functional but lacked visual polish and interactivity.

## Decision

Integrate [Ink](https://github.com/vadimdemedes/ink) (React for CLIs) to provide a modern, component-based terminal UI.

### Technology Choices

- **Ink v6** with **React 19** - Latest versions for best compatibility
- **ink-spinner** - Animated loading indicators
- **ink-box** - Bordered containers for tool output
- **Component-based architecture** - Reusable UI components in `src/ui/`

### Architecture

```
src/ui/
├── App.tsx              # Root Ink component
├── index.ts             # Barrel exports
├── utils.ts             # TTY detection, mode flags
└── components/
    ├── Spinner.tsx      # Loading indicator with elapsed time
    ├── Message.tsx      # Styled chat messages
    ├── ToolOutput.tsx   # Bordered tool results with scroll
    └── index.ts         # Component exports
```

### Output Modes

1. **Ink Mode** (default in TTY): Full React-based rendering with spinners, colors, scrolling
2. **Plain Mode** (`--no-color` or non-TTY): Falls back to `console.log`/`process.stdout.write`
3. **JSON Mode** (`--json`): NDJSON output for programmatic consumption

### Key Implementation Details

1. **JSX in CLI**: Renamed `src/cli/main.ts` → `main.tsx` to support JSX syntax
2. **TTY Detection**: `shouldUseInk()` checks `process.stdout.isTTY` and mode flags
3. **Spinner Lifecycle**: Rendered before LLM call, unmounted on first content chunk
4. **Scrollable Output**: Uses `useInput` hook for keyboard navigation (↑/↓/j/k/PgUp/PgDn)
5. **JSON Format**: `{type: 'user'|'assistant'|'tool', content: string, toolName?: string}`

## Consequences

**Positive:**

- Visual feedback during long LLM calls improves UX
- Component-based UI is maintainable and extensible
- Scrollable tool output handles large results gracefully
- JSON mode enables scripting and tool integration
- Graceful fallback for non-TTY environments

**Negative:**

- Added dependencies: `ink`, `react`, `ink-spinner`, `ink-box`, `@types/react`
- JSX requires `.tsx` extension for files using components
- Slightly increased bundle size
- React paradigm may be unfamiliar to some contributors

**Compatibility Notes:**

- **React 19 + Ink v6**: Using React 19 with Ink v6 is a newer combination. Ink v6 has preliminary React 19 support, but this is less battle-tested than React 18. If issues arise with React concurrent features or hooks, consider pinning to React 18:
  ```json
  "react": "^18.3.0"
  ```
- **Node.js Version**: Ink requires Node.js 16+ which aligns with the project's minimum version

**Future Considerations:**

- Multi-pane layout (sidebar with context, main chat area)
- Persistent status bar with token counts
- Syntax highlighting for code blocks (`ink-syntax-highlight`)
- Interactive file picker or autocomplete
- Custom themes or color configuration
