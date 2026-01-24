import type { MessageRole, ToolCall } from "../providers/types.js";

type Tiktoken = Awaited<ReturnType<typeof import("tiktoken").get_encoding>>;

let _encoder: Tiktoken | null = null;

async function getEncoder(): Promise<Tiktoken | null> {
  if (_encoder) return _encoder;

  try {
    const tiktoken = await import("tiktoken");
    _encoder = await tiktoken.get_encoding("cl100k_base");
    return _encoder;
  } catch {
    // tiktoken not available, use fallback
    return null;
  }
}

// Synchronous fallback using character heuristic (always works)
export function countTokensSync(text: string): number {
  return Math.ceil(text.length / 4);
}

// Async version using tiktoken (accurate for cl100k_base encoding)
export async function countTokens(text: string): Promise<number> {
  const encoder = await getEncoder();
  if (encoder) {
    return encoder.encode(text).length;
  }
  return countTokensSync(text);
}

function countMessageTokens(msg: {
  role: MessageRole;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}): number {
  let total = countTokensSync(msg.content);
  if (msg.toolCalls) {
    for (const tc of msg.toolCalls) total += countTokensSync(JSON.stringify(tc));
  }
  if (msg.toolCallId) total += countTokensSync(msg.toolCallId);
  return total;
}

export async function countMessagesTokens(
  messages: Array<{
    role: MessageRole;
    content: string;
    toolCalls?: ToolCall[];
    toolCallId?: string;
  }>,
): Promise<number> {
  return messages.reduce((total, msg) => total + countMessageTokens(msg), 0);
}

export function countMessagesTokensSync(
  messages: Array<{
    role: MessageRole;
    content: string;
    toolCalls?: ToolCall[];
    toolCallId?: string;
  }>,
): number {
  return messages.reduce((total, msg) => total + countMessageTokens(msg), 0);
}

export async function truncateMessages(
  messages: Array<{
    role: MessageRole;
    content: string;
    toolCalls?: ToolCall[];
    toolCallId?: string;
  }>,
  maxTokens: number,
): Promise<
  Array<{
    role: MessageRole;
    content: string;
    toolCalls?: ToolCall[];
    toolCallId?: string;
  }>
> {
  const encoder = await getEncoder();

  const result: Array<{
    role: MessageRole;
    content: string;
    toolCalls?: ToolCall[];
    toolCallId?: string;
  }> = [];

  const countTokensFn = encoder
    ? (text: string): number => encoder.encode(text).length
    : countTokensSync;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;

    const msgTokens = countTokensFn(msg.content);

    if (msgTokens > maxTokens) {
      const charsToKeep = maxTokens * 4;
      msg.content = msg.content.slice(-charsToKeep);
    }

    result.unshift(msg);

    maxTokens -= countTokensFn(msg.content);
    if (maxTokens <= 0) {
      break;
    }
  }

  return result;
}

export function freeTokenEncoder(): void {
  if (_encoder) {
    _encoder.free();
    _encoder = null;
  }
}
