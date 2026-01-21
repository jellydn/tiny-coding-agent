/**
 * UI Type definitions and enums
 * Provides type safety for status values and UI states
 */

export enum StatusType {
  THINKING = "thinking",
  READY = "ready",
  ERROR = "error",
}

export enum MessageRole {
  USER = "user",
  ASSISTANT = "assistant",
  TOOL = "tool",
}

export enum ToolStatus {
  RUNNING = "running",
  COMPLETE = "complete",
  ERROR = "error",
}

// Re-export for compatibility with existing code
export type ChatMessageRole = MessageRole;
export type ChatToolStatus = ToolStatus;
