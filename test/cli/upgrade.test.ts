import { describe, expect, it } from "bun:test";
import { parseArgs } from "../../src/cli/shared.js";

describe("upgrade flag parsing", () => {
	it("should parse --upgrade flag", () => {
		const result = parseArgs(["--upgrade"]);
		expect(result.options.upgrade).toBe(true);
	});

	it("should combine --upgrade with other flags", () => {
		const result = parseArgs(["--upgrade", "--verbose"]);
		expect(result.options.upgrade).toBe(true);
		expect(result.options.verbose).toBe(true);
	});

	it("should not set upgrade when not provided", () => {
		const result = parseArgs(["run", "test"]);
		expect(result.options.upgrade).toBeUndefined();
	});

	it("should parse --upgrade before command", () => {
		const result = parseArgs(["--upgrade"]);
		expect(result.options.upgrade).toBe(true);
		expect(result.command).toBe("chat"); // default command
	});
});
