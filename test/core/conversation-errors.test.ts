import { describe, it, expect, afterEach } from "bun:test";
import { ConversationManager } from "@/core/conversation.js";
import { writeFileSync, unlinkSync } from "node:fs";

describe("ConversationManager error handling", () => {
  const tempFile = "/tmp/test-conversation-errors.json";

  afterEach(() => {
    try {
      unlinkSync(tempFile);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  it("should handle malformed JSON gracefully", () => {
    writeFileSync(tempFile, "{invalid json}", "utf-8");
    const manager = new ConversationManager(tempFile);
    const history = manager.loadHistory();
    expect(history).toEqual([]);
  });

  it("should handle truncated JSON", () => {
    writeFileSync(tempFile, '{"messages": [{"role": "user", "content": "hello"', "utf-8");
    const manager = new ConversationManager(tempFile);
    const history = manager.loadHistory();
    expect(history).toEqual([]);
  });

  it("should handle missing messages array", () => {
    writeFileSync(tempFile, '{"timestamp": "2024-01-01"}', "utf-8");
    const manager = new ConversationManager(tempFile);
    const history = manager.loadHistory();
    expect(history).toEqual([]);
  });

  it("should handle non-object JSON", () => {
    writeFileSync(tempFile, "null", "utf-8");
    const manager = new ConversationManager(tempFile);
    const history = manager.loadHistory();
    expect(history).toEqual([]);
  });

  it("should handle array instead of object", () => {
    writeFileSync(tempFile, "[1, 2, 3]", "utf-8");
    const manager = new ConversationManager(tempFile);
    const history = manager.loadHistory();
    expect(history).toEqual([]);
  });

  it("should handle empty JSON object", () => {
    writeFileSync(tempFile, "{}", "utf-8");
    const manager = new ConversationManager(tempFile);
    const history = manager.loadHistory();
    expect(history).toEqual([]);
  });

  it("should return empty array for non-existent file", () => {
    const manager = new ConversationManager("/non/existent/file.json");
    const history = manager.loadHistory();
    expect(history).toEqual([]);
  });

  it("should return empty array when no file is specified", () => {
    const manager = new ConversationManager();
    const history = manager.loadHistory();
    expect(history).toEqual([]);
  });

  it("should load valid conversation file correctly", () => {
    const validContent = JSON.stringify({
      timestamp: "2024-01-01T00:00:00.000Z",
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi there" },
      ],
    });
    writeFileSync(tempFile, validContent, "utf-8");
    const manager = new ConversationManager(tempFile);
    const history = manager.loadHistory();
    expect(history).toHaveLength(2);
    expect(history[0]).toEqual({ role: "user", content: "hello" });
    expect(history[1]).toEqual({ role: "assistant", content: "hi there" });
  });

  it("should handle empty messages array", () => {
    writeFileSync(tempFile, '{"messages": []}', "utf-8");
    const manager = new ConversationManager(tempFile);
    const history = manager.loadHistory();
    expect(history).toEqual([]);
  });

  it("should handle messages array with invalid objects", () => {
    // This tests that we return the array even if content is malformed
    writeFileSync(tempFile, '{"messages": [{"role": "user"}]}', "utf-8");
    const manager = new ConversationManager(tempFile);
    const history = manager.loadHistory();
    // Should return the array as-is, validation is minimal
    expect(history).toHaveLength(1);
  });
});
