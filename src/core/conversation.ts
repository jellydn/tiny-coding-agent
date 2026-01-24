import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Message } from "../providers/types.js";

export interface ConversationManagerOptions {
  conversationFile?: string;
}

export class ConversationManager {
  private _conversationHistory: Message[] = [];

  constructor(readonly conversationFile?: string) {}

  startSession(): void {
    this._conversationHistory = [];
  }

  getHistory(): Message[] {
    return this._conversationHistory;
  }

  async setHistory(messages: Message[]): Promise<void> {
    this._conversationHistory = messages;
    await this._save();
  }

  loadHistory(): Message[] {
    if (!this.conversationFile || !existsSync(this.conversationFile)) {
      return [];
    }

    try {
      const content = readFileSync(this.conversationFile, "utf-8");
      const parsed = JSON.parse(content);

      // Validate structure
      if (!parsed || typeof parsed !== "object") {
        console.warn(`Warning: Invalid conversation file format in ${this.conversationFile}`);
        return [];
      }

      if (!Array.isArray(parsed.messages)) {
        console.warn(
          `Warning: Conversation file missing messages array in ${this.conversationFile}`,
        );
        return [];
      }

      return parsed.messages;
    } catch (err) {
      if (err instanceof SyntaxError) {
        console.error(`Warning: Malformed JSON in ${this.conversationFile}: ${err.message}`);
      } else {
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
        2,
      );
      writeFileSync(this.conversationFile, data, "utf-8");
    } catch (err) {
      console.error(`Warning: Failed to save conversation to ${this.conversationFile}: ${err}`);
    }
  }

  async close(): Promise<void> {
    // No-op: simplified implementation without locks
  }
}
