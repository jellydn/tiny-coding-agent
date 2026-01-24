import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Message } from "../providers/types.js";

export interface ConversationManagerOptions {
  conversationFile?: string;
}

export class ConversationManager {
  private _conversationHistory: Message[] = [];

  constructor(
    readonly conversationFile?: string,
  ) {}

  startSession(): void {
    this._conversationHistory = [];
  }

  getHistory(): Message[] {
    return this._conversationHistory;
  }

  setHistory(messages: Message[]): void {
    this._conversationHistory = messages;
    this._save();
  }

  loadHistory(): Message[] {
    if (!this.conversationFile || !existsSync(this.conversationFile)) {
      return [];
    }

    try {
      const content = readFileSync(this.conversationFile, "utf-8");
      return JSON.parse(content).messages || [];
    } catch (err) {
      console.error(`Warning: Failed to load conversation from ${this.conversationFile}: ${err}`);
      return [];
    }
  }

  private _save(): void {
    if (!this.conversationFile) return;

    try {
      writeFileSync(
        this.conversationFile,
        JSON.stringify({ timestamp: new Date().toISOString(), messages: this._conversationHistory }, null, 2),
        "utf-8",
      );
    } catch (err) {
      console.error(`Warning: Failed to save conversation to ${this.conversationFile}: ${err}`);
    }
  }
}
