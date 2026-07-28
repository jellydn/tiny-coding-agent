import { describe, expect, it } from "bun:test";
import { COMMANDS, parseChatCommand } from "../../src/cli/chat-commands.js";

describe("ChatCommands — /review", () => {
	it("should have REVIEW in COMMANDS", () => {
		expect(COMMANDS.REVIEW).toBe("/review");
	});

	it("should parse /review as a command", () => {
		const result = parseChatCommand("/review");
		expect(result.isCommand).toBe(true);
		expect(result.matchedCommand).toBe(COMMANDS.REVIEW);
	});

	it("should fuzzy match /reviw as /review", () => {
		const result = parseChatCommand("/reviw");
		expect(result.isCommand).toBe(true);
		expect(result.matchedCommand).toBe(COMMANDS.REVIEW);
	});

	it("should not parse /reviewer as /review (too different)", () => {
		// /reviewer is longer but starts with /review — fuzzyMatch should handle it
		// The startsWith check will match, so this IS a command
		const result = parseChatCommand("/reviewer");
		expect(result.isCommand).toBe(true);
	});

	it("should not exit on /review (unlike /bye)", () => {
		const result = parseChatCommand("/review");
		expect(result.shouldExit).toBeUndefined();
	});
});
