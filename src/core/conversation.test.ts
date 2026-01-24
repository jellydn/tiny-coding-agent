import { describe, it, expect, beforeEach } from "bun:test";
import { unlinkSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import type { Message } from "../providers/types.js";
import { ConversationManager } from "./conversation.js";

const tempConversationFile = "/tmp/test-conversation.json";

beforeEach(() => {
  try {
    unlinkSync(tempConversationFile);
  } catch {
    // Ignore if file doesn't exist
  }
});

describe("ConversationManager", () => {
  describe("constructor", () => {
    it("should initialize with empty history when no file path is set", () => {
      const manager = new ConversationManager();
      expect(manager.getHistory()).toEqual([]);
    });

    it("should initialize with empty history when file does not exist", () => {
      const manager = new ConversationManager("/nonexistent/path/conversation.json");
      expect(manager.getHistory()).toEqual([]);
    });
  });

  describe("startSession()", () => {
    it("should reset history to empty array", () => {
      const manager = new ConversationManager();
      manager.setHistory([{ role: "user", content: "test" } as Message]);
      manager.startSession();
      expect(manager.getHistory()).toEqual([]);
    });
  });

  describe("setHistory()", () => {
    it("should update the conversation history", () => {
      const manager = new ConversationManager();
      const messages: Message[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ];
      manager.setHistory(messages);
      expect(manager.getHistory()).toEqual(messages);
    });
  });

  describe("loadHistory()", () => {
    it("should load history from file when file exists", () => {
      const messages: Message[] = [
        { role: "user", content: "Previous message" },
        { role: "assistant", content: "Previous response" },
      ];
      writeFileSync(tempConversationFile, JSON.stringify({ messages }, null, 2));

      const manager = new ConversationManager(tempConversationFile);
      const loaded = manager.loadHistory();
      expect(loaded).toEqual(messages);
    });

    it("should return empty array when file does not exist", () => {
      const manager = new ConversationManager("/nonexistent/path/conversation.json");
      const loaded = manager.loadHistory();
      expect(loaded).toEqual([]);
    });

    it("should return empty array when file contains invalid JSON", () => {
      writeFileSync(tempConversationFile, "invalid json");

      const manager = new ConversationManager(tempConversationFile);
      const loaded = manager.loadHistory();
      expect(loaded).toEqual([]);
    });
  });

  describe("file persistence", () => {
    it("should save history to file when setHistory is called", () => {
      const manager = new ConversationManager(tempConversationFile);

      const messages: Message[] = [{ role: "user", content: "Test message" }];
      manager.setHistory(messages);

      expect(existsSync(tempConversationFile)).toBe(true);

      const saved = JSON.parse(readFileSync(tempConversationFile, "utf-8"));
      expect(saved.messages).toEqual(messages);
      expect(saved.timestamp).toBeDefined();
    });

    it("should not save to file when no file path is configured", () => {
      const manager = new ConversationManager();
      const messages: Message[] = [{ role: "user", content: "Test" }];

      // Should not throw
      manager.setHistory(messages);
      expect(manager.getHistory()).toEqual(messages);
    });
  });

  describe("conversationFile property", () => {
    it("should return the configured file path", () => {
      const manager = new ConversationManager("/test/path.json");
      expect(manager.conversationFile).toBe("/test/path.json");
    });

    it("should return undefined when no file path is set", () => {
      const manager = new ConversationManager();
      expect(manager.conversationFile).toBeUndefined();
    });
  });
});
