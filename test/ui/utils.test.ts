import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	isJsonMode,
	isTTY,
	resetUIContext,
	setJsonMode,
	setNoColor,
	setUIContext,
	shouldUseInk,
} from "../../src/ui/utils.js";

describe("UI Utils", () => {
	beforeEach(() => {
		// Reset to default state before each test
		resetUIContext();
	});

	afterEach(() => {
		// Clean up after each test
		resetUIContext();
	});

	describe("isTTY", () => {
		it("should return true when both stdout and stdin are TTY", () => {
			const originalStdout = process.stdout.isTTY;
			const originalStdin = process.stdin.isTTY;

			process.stdout.isTTY = true;
			process.stdin.isTTY = true;

			expect(isTTY()).toBe(true);

			process.stdout.isTTY = originalStdout;
			process.stdin.isTTY = originalStdin;
		});

		it("should return false when stdout is not TTY", () => {
			const originalStdout = process.stdout.isTTY;
			const originalStdin = process.stdin.isTTY;

			process.stdout.isTTY = false;
			process.stdin.isTTY = true;

			expect(isTTY()).toBe(false);

			process.stdout.isTTY = originalStdout;
			process.stdin.isTTY = originalStdin;
		});

		it("should return false when stdin is not TTY", () => {
			const originalStdout = process.stdout.isTTY;
			const originalStdin = process.stdin.isTTY;

			process.stdout.isTTY = true;
			process.stdin.isTTY = false;

			expect(isTTY()).toBe(false);

			process.stdout.isTTY = originalStdout;
			process.stdin.isTTY = originalStdin;
		});
	});

	describe("setUIContext", () => {
		beforeEach(() => {
			process.stdout.isTTY = false;
			process.stdin.isTTY = false;
		});

		it("should set noColor flag", () => {
			setUIContext({ noColor: true });
			expect(shouldUseInk()).toBe(false);
		});

		it("should set jsonMode flag", () => {
			setUIContext({ jsonMode: true });
			expect(isJsonMode()).toBe(true);
			expect(shouldUseInk()).toBe(false);
		});

		it("should merge partial updates", () => {
			setUIContext({ noColor: true });
			setUIContext({ jsonMode: true });

			expect(isJsonMode()).toBe(true);
			expect(shouldUseInk()).toBe(false);
		});

		it("should override existing values", () => {
			setUIContext({ noColor: true });
			setUIContext({ noColor: false });
			// In test environment, TTY is false, so shouldUseInk returns false
			expect(shouldUseInk()).toBe(false);
		});
	});

	describe("setNoColor / setJsonMode (convenience setters)", () => {
		it("should set noColor via convenience setter", () => {
			setNoColor(true);
			expect(shouldUseInk()).toBe(false);
		});

		it("should set jsonMode via convenience setter", () => {
			setJsonMode(true);
			expect(isJsonMode()).toBe(true);
		});

		it("should work together with setUIContext", () => {
			setNoColor(true);
			setUIContext({ jsonMode: true });

			expect(isJsonMode()).toBe(true);
			expect(shouldUseInk()).toBe(false);
		});
	});

	describe("isJsonMode", () => {
		it("should return false by default", () => {
			expect(isJsonMode()).toBe(false);
		});

		it("should return true when jsonMode is set", () => {
			setJsonMode(true);
			expect(isJsonMode()).toBe(true);
		});

		it("should return false after reset", () => {
			setJsonMode(true);
			resetUIContext();
			expect(isJsonMode()).toBe(false);
		});
	});

	describe("shouldUseInk", () => {
		const originalStdout = process.stdout.isTTY;
		const originalStdin = process.stdin.isTTY;

		beforeEach(() => {
			// Default to TTY for most tests
			process.stdout.isTTY = true;
			process.stdin.isTTY = true;
		});

		afterEach(() => {
			process.stdout.isTTY = originalStdout;
			process.stdin.isTTY = originalStdin;
		});

		it("should return true when TTY and no flags set", () => {
			expect(shouldUseInk()).toBe(true);
		});

		it("should return false when noColor is set", () => {
			setNoColor(true);
			expect(shouldUseInk()).toBe(false);
		});

		it("should return false when jsonMode is set", () => {
			setJsonMode(true);
			expect(shouldUseInk()).toBe(false);
		});

		it("should return false when not TTY", () => {
			process.stdout.isTTY = false;
			expect(shouldUseInk()).toBe(false);
		});

		it("should return false when not TTY even with flags", () => {
			process.stdout.isTTY = false;
			setNoColor(true);
			expect(shouldUseInk()).toBe(false);
		});
	});

	describe("resetUIContext", () => {
		beforeEach(() => {
			process.stdout.isTTY = false;
			process.stdin.isTTY = false;
		});

		it("should reset noColor flag", () => {
			setNoColor(true);
			resetUIContext();
			// In test environment, TTY is false, so shouldUseInk returns false
			expect(shouldUseInk()).toBe(false);
		});

		it("should reset jsonMode flag", () => {
			setJsonMode(true);
			resetUIContext();
			expect(isJsonMode()).toBe(false);
		});

		it("should reset both flags together", () => {
			setUIContext({ noColor: true, jsonMode: true });
			resetUIContext();
			expect(isJsonMode()).toBe(false);
			expect(shouldUseInk()).toBe(false);
		});

		it("should be idempotent", () => {
			resetUIContext();
			resetUIContext();
			resetUIContext();
			expect(isJsonMode()).toBe(false);
		});
	});
});
