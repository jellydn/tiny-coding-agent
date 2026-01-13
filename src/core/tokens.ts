import type { MessageRole, ToolCall } from "../providers/types.js";

export function countTokens(text: string): number {
  const chars = text.length;
  return Math.ceil(chars / 4);
}

export function countMessagesTokens(
  messages: Array<{
    role: MessageRole;
    content: string;
    toolCalls?: ToolCall[];
    toolCallId?: string;
  }>,
): number {
  let total = 0;
  for (const msg of messages) {
    total += countTokens(msg.content);
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        total += countTokens(JSON.stringify(tc));
      }
    }
    if (msg.toolCallId) {
      total += countTokens(msg.toolCallId);
    }
  }
  return total;
}

export function truncateMessages(
  messages: Array<{
    role: MessageRole;
    content: string;
    toolCalls?: ToolCall[];
    toolCallId?: string;
  }>,
  maxTokens: number,
): Array<{
  role: MessageRole;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}> {
  const result: Array<{
    role: MessageRole;
    content: string;
    toolCalls?: ToolCall[];
    toolCallId?: string;
  }> = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;

    const msgTokens = countTokens(msg.content);

    if (msgTokens > maxTokens) {
      const charsToKeep = maxTokens * 4;
      msg.content = msg.content.slice(-charsToKeep);
    }

    result.unshift(msg);

    maxTokens -= countTokens(msg.content);
    if (maxTokens <= 0) {
      break;
    }
  }

  return result;
}
