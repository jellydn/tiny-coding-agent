import * as fs from "node:fs/promises";
import type { Message } from "../providers/types.js";

export interface ConversationManagerOptions {
	/** Maximum number of messages to keep in history (0 = unlimited) */
	maxMessages?: number;
	/** Maximum token count for history (0 = unlimited) */
	maxTokens?: number;
}

function isValidConversationFile(content: unknown): content is { messages: Message[] } {
	if (!content || typeof content !== "object") return false;
	if (!Array.isArray((content as { messages?: unknown }).messages)) return false;
	return true;
}

export class ConversationManager {
	private _conversationHistory: Message[] = [];
	private readonly _maxMessages: number;

	constructor(
		readonly conversationFile?: string,
		options: ConversationManagerOptions = {}
	) {
		this._maxMessages = options.maxMessages ?? 0;
	}

	startSession(): void {
		this._conversationHistory = [];
	}

	getHistory(): Message[] {
		return this._conversationHistory;
	}

	async setHistory(messages: Message[]): Promise<void> {
		this._conversationHistory = this._truncateHistory(messages);
		await this._save();
	}

	private _truncateHistory(messages: Message[]): Message[] {
		// Apply max messages limit (keep most recent messages)
		if (this._maxMessages > 0) {
			return messages.slice(-this._maxMessages);
		}
		return messages;
	}

	async loadHistory(): Promise<Message[]> {
		if (!this.conversationFile) return [];

		try {
			const content = await fs.readFile(this.conversationFile, "utf-8");
			const parsed = JSON.parse(content);

			// Guard: validate structure
			if (!isValidConversationFile(parsed)) {
				console.warn(`Warning: Invalid conversation file format in ${this.conversationFile}`);
				return [];
			}

			return parsed.messages;
		} catch (err) {
			if (err instanceof SyntaxError) {
				console.error(`Warning: Malformed JSON in ${this.conversationFile}: ${err.message}`);
			} else if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
				console.error(`Warning: Failed to load conversation from ${this.conversationFile}: ${err}`);
			}
			return [];
		}
	}

	private async _save(): Promise<void> {
		if (!this.conversationFile) return;

		try {
			const data = JSON.stringify(
				{ timestamp: new Date().toISOString(), messages: this._conversationHistory },
				null,
				2
			);
			await fs.writeFile(this.conversationFile, data, "utf-8");
		} catch (err) {
			console.error(`Warning: Failed to save conversation to ${this.conversationFile}: ${err}`);
		}
	}

	async close(): Promise<void> {
		await this._save();
	}

	/** Get current history count for monitoring */
	getHistoryCount(): number {
		return this._conversationHistory.length;
	}
}
