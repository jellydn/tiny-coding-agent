import { beforeEach, describe, expect, it } from "bun:test";
import { formatArgs, ThinkingTagFilter } from "./main.js";

// Thinking tag constants - these are the actual strings the filter looks for
const THINK_START = "<thinking>";
const THINK_END = "</thinking>";

describe("main.tsx helper functions", () => {
	describe("ThinkingTagFilter", () => {
		let filter: ThinkingTagFilter;

		beforeEach(() => {
			filter = new ThinkingTagFilter();
		});

		describe("filter", () => {
			it("should pass through text without thinking blocks", () => {
				const result = filter.filter("Hello world");
				expect(result).toBe("Hello world");
			});

			it("should remove thinking tags and content between them", () => {
				const input = `Before${THINK_START}Some content${THINK_END}After`;
				const result = filter.filter(input);
				expect(result).toBe("Before\nAfter");
			});

			it("should handle multiple thinking blocks", () => {
				const input =
					"Start" +
					THINK_START +
					"First think" +
					THINK_END +
					"Middle" +
					THINK_START +
					"Second think" +
					THINK_END +
					"End";
				const result = filter.filter(input);
				expect(result).toBe("Start\nMiddle\nEnd");
			});

			it("should handle partial thinking block at end of chunk", () => {
				const input = `Text${THINK_START}Partial thinking block`;
				const result = filter.filter(input);
				expect(result).toBe("Text\n");
			});

			it("should handle thinking block spanning multiple chunks", () => {
				const result1 = filter.filter(`Start${THINK_START}Thinking `);
				expect(result1).toBe("Start\n");
				const result2 = filter.filter(`more thinking${THINK_END}End`);
				expect(result2).toBe("End");
			});

			it("should handle consecutive thinking blocks", () => {
				const input = `${THINK_START}think1${THINK_END}${THINK_START}think2${THINK_END}`;
				const result = filter.filter(input);
				expect(result).toBe("");
			});

			it("should handle empty input", () => {
				const result = filter.filter("");
				expect(result).toBe("");
			});

			it("should handle only thinking block", () => {
				const input = `${THINK_START}thinking content${THINK_END}`;
				const result = filter.filter(input);
				expect(result).toBe("");
			});
		});

		describe("flush", () => {
			it("should return empty string when not in thinking block", () => {
				filter.filter("Hello");
				const result = filter.flush();
				expect(result).toBe("");
			});

			it("should discard incomplete thinking block when flushing", () => {
				filter.filter(`Start${THINK_START}unfinished`);
				const result = filter.flush();
				expect(result).toBe("");
			});

			it("should clear the buffer after flushing", () => {
				filter.filter("test");
				filter.flush();
				const result = filter.filter("after");
				expect(result).toBe("after");
			});
		});
	});

	describe("formatArgs", () => {
		it("should return empty string for undefined args", () => {
			const result = formatArgs(undefined);
			expect(result).toBe("");
		});

		it("should return empty string for empty object", () => {
			const result = formatArgs({});
			expect(result).toBe("");
		});

		it("should format single argument", () => {
			const result = formatArgs({ path: "/test/file.txt" });
			expect(result).toBe(" (path=/test/file.txt)");
		});

		it("should format multiple arguments", () => {
			const result = formatArgs({ path: "/test", recursive: true });
			expect(result).toBe(" (path=/test, recursive=true)");
		});

		it("should skip undefined values", () => {
			const result = formatArgs({ path: "/test", recursive: undefined });
			expect(result).toBe(" (path=/test)");
		});

		it("should truncate long string values", () => {
			const longContent = "a".repeat(80);
			const result = formatArgs({ content: longContent });
			expect(result).toContain("...");
			expect(result).toContain("more chars)");
		});

		it("should format long content argument with line break", () => {
			const longContent = "a".repeat(350);
			const result = formatArgs({ content: longContent });
			expect(result).toContain("content=\n");
			expect(result).toContain("... (");
			expect(result).toContain("more chars)");
		});

		it("should format JSON for non-string values", () => {
			const result = formatArgs({ timeout: 60000 });
			expect(result).toContain("timeout=60000");
		});

		it("should handle multiple long arguments", () => {
			const result = formatArgs({
				path: "a".repeat(80),
				content: "short",
			});
			expect(result).toContain("...");
		});
	});
});
