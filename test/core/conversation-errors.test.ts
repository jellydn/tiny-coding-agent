import { afterEach, describe, expect, it } from "bun:test";
import { unlinkSync, writeFileSync } from "node:fs";
import { ConversationManager } from "../../src/core/conversation.js";

describe("ConversationManager error handling", () => {
	const tempFile = "/tmp/test-conversation-errors.json";

	afterEach(() => {
		try {
			unlinkSync(tempFile);
		} catch {
			// Ignore if file doesn't exist
		}
	});

	it("should handle malformed JSON gracefully", async () => {
		writeFileSync(tempFile, "{invalid json}", "utf-8");
		const manager = new ConversationManager(tempFile);
		const history = await manager.loadHistory();
		expect(history).toEqual([]);
	});

	it("should handle truncated JSON", async () => {
		writeFileSync(tempFile, '{"messages": [{"role": "user", "content": "hello"', "utf-8");
		const manager = new ConversationManager(tempFile);
		const history = await manager.loadHistory();
		expect(history).toEqual([]);
	});

	it("should handle missing messages array", async () => {
		writeFileSync(tempFile, '{"timestamp": "2024-01-01"}', "utf-8");
		const manager = new ConversationManager(tempFile);
		const history = await manager.loadHistory();
		expect(history).toEqual([]);
	});

	it("should handle non-object JSON", async () => {
		writeFileSync(tempFile, "null", "utf-8");
		const manager = new ConversationManager(tempFile);
		const history = await manager.loadHistory();
		expect(history).toEqual([]);
	});

	it("should handle array instead of object", async () => {
		writeFileSync(tempFile, "[1, 2, 3]", "utf-8");
		const manager = new ConversationManager(tempFile);
		const history = await manager.loadHistory();
		expect(history).toEqual([]);
	});

	it("should handle empty JSON object", async () => {
		writeFileSync(tempFile, "{}", "utf-8");
		const manager = new ConversationManager(tempFile);
		const history = await manager.loadHistory();
		expect(history).toEqual([]);
	});

	it("should return empty array for non-existent file", async () => {
		const manager = new ConversationManager("/non/existent/file.json");
		const history = await manager.loadHistory();
		expect(history).toEqual([]);
	});

	it("should return empty array when no file is specified", async () => {
		const manager = new ConversationManager();
		const history = await manager.loadHistory();
		expect(history).toEqual([]);
	});

	it("should load valid conversation file correctly", async () => {
		const validContent = JSON.stringify({
			timestamp: "2024-01-01T00:00:00.000Z",
			messages: [
				{ role: "user", content: "hello" },
				{ role: "assistant", content: "hi there" },
			],
		});
		writeFileSync(tempFile, validContent, "utf-8");
		const manager = new ConversationManager(tempFile);
		const history = await manager.loadHistory();
		expect(history).toHaveLength(2);
		expect(history[0]).toEqual({ role: "user", content: "hello" });
		expect(history[1]).toEqual({ role: "assistant", content: "hi there" });
	});

	it("should handle empty messages array", async () => {
		writeFileSync(tempFile, '{"messages": []}', "utf-8");
		const manager = new ConversationManager(tempFile);
		const history = await manager.loadHistory();
		expect(history).toEqual([]);
	});

	it("should handle messages array with invalid objects", async () => {
		// This tests that we return the array even if content is malformed
		writeFileSync(tempFile, '{"messages": [{"role": "user"}]}', "utf-8");
		const manager = new ConversationManager(tempFile);
		const history = await manager.loadHistory();
		// Should return the array as-is, validation is minimal
		expect(history).toHaveLength(1);
	});
});
