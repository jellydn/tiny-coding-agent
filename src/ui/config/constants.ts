/**
 * UI Configuration Constants
 * Centralized configuration for UI values, timeouts, and display limits
 */

// Text truncation limits
export const TRUNCATE_LIMITS = {
  TOOL_ARGS: 30,
  TOOL_OUTPUT_PREVIEW: 10,
  TOOL_OUTPUT_INLINE: 3,
  MODEL_NAME_MAX: 30,
} as const;

// Layout constants
// CONTEXT_MAX_MODEL_WIDTH: Minimum width reserved for model name display
// TERMINAL_WIDTH_BUFFER: Buffer for other status line elements (status, context, tool)
// This ensures model name gets at least 20 chars, but more if terminal is wider
export const LAYOUT = {
  CONTEXT_MAX_MODEL_WIDTH: 20,
  TERMINAL_WIDTH_BUFFER: 35,
} as const;

// Timing constants (in milliseconds)
export const TIMING = {
  BLINK_CURSOR: 500,
  TOOL_TIMER_UPDATE: 100,
  STREAMING_UPDATE: 50,
} as const;

// Display formatting
export const FORMATTING = {
  COMPACT_NUMBER_THRESHOLD: 1000,
  COMPACT_NUMBER_DECIMALS: 1,
} as const;

// Status colors and labels
export const STATUS_CONFIG = {
  LABELS: {
    thinking: "⏳ Thinking",
    ready: "✓ Ready",
    error: "✗ Error",
  } as const,
  COLORS: {
    thinking: "yellow",
    ready: "green",
    error: "red",
  } as const,
} as const;
