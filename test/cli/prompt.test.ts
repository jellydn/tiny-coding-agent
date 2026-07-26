import { beforeEach, describe, expect, it, vi } from "bun:test";
import * as readline from "node:readline";
import { prompt, promptChoice, promptHidden } from "../../src/cli/prompt.js";

describe("cli/prompt", () => {
	describe("prompt()", () => {
		it("should return the trimmed answer", async () => {
			const createInterfaceSpy = vi.spyOn(readline, "createInterface").mockImplementation(
				() =>
					({
						question: (_q: string, cb: (answer: string) => void) => {
							queueMicrotask(() => cb("  hello world  "));
						},
						close: () => {},
					}) as unknown as readline.Interface
			);

			const result = await prompt("What is your name? ");
			expect(result).toBe("hello world");

			createInterfaceSpy.mockRestore();
		});

		it("should return empty string for empty input", async () => {
			const createInterfaceSpy = vi.spyOn(readline, "createInterface").mockImplementation(
				() =>
					({
						question: (_q: string, cb: (answer: string) => void) => {
							queueMicrotask(() => cb(""));
						},
						close: () => {},
					}) as unknown as readline.Interface
			);

			const result = await prompt("Enter something: ");
			expect(result).toBe("");

			createInterfaceSpy.mockRestore();
		});

		it("should pass the question to readline", async () => {
			let capturedQuestion = "";
			const createInterfaceSpy = vi.spyOn(readline, "createInterface").mockImplementation(
				() =>
					({
						question: (q: string, cb: (answer: string) => void) => {
							capturedQuestion = q;
							queueMicrotask(() => cb("answer"));
						},
						close: () => {},
					}) as unknown as readline.Interface
			);

			await prompt("Enter your name: ");
			expect(capturedQuestion).toBe("Enter your name: ");

			createInterfaceSpy.mockRestore();
		});
	});

	describe("promptHidden()", () => {
		// Force non-TTY so promptHidden uses the readline fallback path
		beforeEach(() => {
			process.stdin.isTTY = false;
		});

		it("should return the trimmed answer (non-TTY fallback)", async () => {
			const stdoutWriteSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
			const createInterfaceSpy = vi.spyOn(readline, "createInterface").mockImplementation(
				() =>
					({
						question: (_q: string, cb: (answer: string) => void) => {
							queueMicrotask(() => cb("sk-secret-key  "));
						},
						close: () => {},
					}) as unknown as readline.Interface
			);

			const result = await promptHidden("Enter your API key: ");
			expect(result).toBe("sk-secret-key");

			stdoutWriteSpy.mockRestore();
			createInterfaceSpy.mockRestore();
		});

		it("should write the prompt text to stdout", async () => {
			const stdoutWriteSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
			const createInterfaceSpy = vi.spyOn(readline, "createInterface").mockImplementation(
				() =>
					({
						question: (_q: string, cb: (answer: string) => void) => {
							queueMicrotask(() => cb("answer"));
						},
						close: () => {},
					}) as unknown as readline.Interface
			);

			await promptHidden("Password: ");
			expect(stdoutWriteSpy).toHaveBeenCalledWith("Password: ");

			stdoutWriteSpy.mockRestore();
			createInterfaceSpy.mockRestore();
		});

		it("should return empty string for empty input", async () => {
			const stdoutWriteSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
			const createInterfaceSpy = vi.spyOn(readline, "createInterface").mockImplementation(
				() =>
					({
						question: (_q: string, cb: (answer: string) => void) => {
							queueMicrotask(() => cb(""));
						},
						close: () => {},
					}) as unknown as readline.Interface
			);

			const result = await promptHidden("Key: ");
			expect(result).toBe("");

			stdoutWriteSpy.mockRestore();
			createInterfaceSpy.mockRestore();
		});
	});

	describe("promptChoice()", () => {
		it("should return the matched option (case-insensitive)", async () => {
			const createInterfaceSpy = vi.spyOn(readline, "createInterface").mockImplementation(
				() =>
					({
						question: (_q: string, cb: (answer: string) => void) => {
							queueMicrotask(() => cb("SKIP"));
						},
						close: () => {},
					}) as unknown as readline.Interface
			);

			const result = await promptChoice("What to do?", ["retry", "skip", "abort"]);
			expect(result).toBe("skip");

			createInterfaceSpy.mockRestore();
		});

		it("should return the first option when no match", async () => {
			const createInterfaceSpy = vi.spyOn(readline, "createInterface").mockImplementation(
				() =>
					({
						question: (_q: string, cb: (answer: string) => void) => {
							queueMicrotask(() => cb("xyz"));
						},
						close: () => {},
					}) as unknown as readline.Interface
			);

			const result = await promptChoice("What to do?", ["retry", "skip", "abort"]);
			expect(result).toBe("retry");

			createInterfaceSpy.mockRestore();
		});

		it("should return the first option for empty input", async () => {
			const createInterfaceSpy = vi.spyOn(readline, "createInterface").mockImplementation(
				() =>
					({
						question: (_q: string, cb: (answer: string) => void) => {
							queueMicrotask(() => cb(""));
						},
						close: () => {},
					}) as unknown as readline.Interface
			);

			const result = await promptChoice("What to do?", ["retry", "skip", "abort"]);
			expect(result).toBe("retry");

			createInterfaceSpy.mockRestore();
		});

		it("should include options in the prompt text", async () => {
			let capturedQuestion = "";
			const createInterfaceSpy = vi.spyOn(readline, "createInterface").mockImplementation(
				() =>
					({
						question: (q: string, cb: (answer: string) => void) => {
							capturedQuestion = q;
							queueMicrotask(() => cb("retry"));
						},
						close: () => {},
					}) as unknown as readline.Interface
			);

			await promptChoice("Choose:", ["retry", "skip", "abort"]);
			expect(capturedQuestion).toContain("retry");
			expect(capturedQuestion).toContain("skip");
			expect(capturedQuestion).toContain("abort");

			createInterfaceSpy.mockRestore();
		});
	});
});
