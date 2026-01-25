import type { MessageRole, ToolCall } from "../providers/types.js";

type Tiktoken = Awaited<ReturnType<typeof import("tiktoken").get_encoding>>;

let _encoder: Tiktoken | null = null;
let _warnedAboutFallback = false;

const _tokenCache = new Map<string, number>();

async function getEncoder(): Promise<Tiktoken | null> {
	if (_encoder) return _encoder;

	try {
		const tiktoken = await import("tiktoken");
		_encoder = tiktoken.get_encoding("cl100k_base");
		return _encoder;
	} catch {
		// tiktoken not available, use fallback
		if (!_warnedAboutFallback) {
			console.warn(
				"[WARN] tiktoken not available - using inaccurate character-based token counting. " +
					"Install tiktoken for accurate context budget calculations."
			);
			_warnedAboutFallback = true;
		}
		return null;
	}
}

// Synchronous fallback using character heuristic (always works)
export function countTokensSync(text: string): number {
	const cached = _tokenCache.get(text);
	if (cached !== undefined) return cached;
	const count = Math.ceil(text.length / 4);
	if (_tokenCache.size < 10000) {
		_tokenCache.set(text, count);
	}
	return count;
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
	}>
): Promise<number> {
	return messages.reduce((total, msg) => total + countMessageTokens(msg), 0);
}

export function countMessagesTokensSync(
	messages: Array<{
		role: MessageRole;
		content: string;
		toolCalls?: ToolCall[];
		toolCallId?: string;
	}>
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
	maxTokens: number
): Promise<
	Array<{
		role: MessageRole;
		content: string;
		toolCalls?: ToolCall[];
		toolCallId?: string;
	}>
> {
	const encoder = await getEncoder();
	const countTokensFn = encoder ? (text: string): number => encoder.encode(text).length : countTokensSync;

	const result: Array<{
		role: MessageRole;
		content: string;
		toolCalls?: ToolCall[];
		toolCallId?: string;
	}> = [];

	for (let i = messages.length - 1; i >= 0 && maxTokens > 0; i--) {
		const msg = messages[i];
		if (!msg) continue;

		const msgTokens = countTokensFn(msg.content);
		if (msgTokens > maxTokens) {
			msg.content = msg.content.slice(-(maxTokens * 4));
		}

		result.unshift(msg);
		maxTokens -= countTokensFn(msg.content);
	}

	return result;
}

export function freeTokenEncoder(): void {
	if (_encoder) {
		_encoder.free();
		_encoder = null;
	}
	_tokenCache.clear();
}
