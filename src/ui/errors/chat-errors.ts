/**
 * Error types for chat interface
 * Provides specific error handling with user-friendly messages
 */

export class ChatError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ChatError";
  }
}

export class AgentNotInitializedError extends ChatError {
  constructor() {
    super("Agent not initialized", "AGENT_NOT_INITIALIZED");
  }
}

export class MessageEmptyError extends ChatError {
  constructor() {
    super("Message cannot be empty", "MESSAGE_EMPTY");
  }
}

export class ModelNotFoundError extends ChatError {
  constructor(model: string) {
    super(`Model not found: ${model}`, "MODEL_NOT_FOUND", { model });
  }
}

export class ToolExecutionError extends ChatError {
  constructor(
    toolName: string,
    originalError: unknown,
  ) {
    super(
      `Tool execution failed: ${toolName}`,
      "TOOL_EXECUTION_ERROR",
      { toolName, originalError },
    );
  }
}

export class StreamError extends ChatError {
  constructor(originalError: unknown) {
    super(
      "Stream processing error",
      "STREAM_ERROR", 
      { originalError },
    );
  }
}