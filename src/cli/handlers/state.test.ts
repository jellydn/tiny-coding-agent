import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { handleState } from "./state.js";

const TEMP_STATE_FILE = `/tmp/test-state-${Date.now()}.json`;

describe("handleState", () => {
	beforeEach(() => {
		if (existsSync(TEMP_STATE_FILE)) {
			unlinkSync(TEMP_STATE_FILE);
		}
	});

	afterEach(() => {
		if (existsSync(TEMP_STATE_FILE)) {
			unlinkSync(TEMP_STATE_FILE);
		}
	});

	it("should show state file content", async () => {
		const testState = { test: true };
		await import("node:fs/promises").then((fs) => fs.writeFile(TEMP_STATE_FILE, JSON.stringify(testState), "utf-8"));

		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await handleState({}, ["show"], { stateFile: TEMP_STATE_FILE });
		expect(consoleLogSpy).toHaveBeenCalled();
		consoleLogSpy.mockRestore();
	});

	it("should show state file with json flag", async () => {
		const testState = { test: true };
		await import("node:fs/promises").then((fs) => fs.writeFile(TEMP_STATE_FILE, JSON.stringify(testState), "utf-8"));

		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await handleState({}, ["show"], { stateFile: TEMP_STATE_FILE, json: true });
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('"test": true'));
		consoleLogSpy.mockRestore();
	});

	it("should clear state file", async () => {
		const testState = { test: true };
		await import("node:fs/promises").then((fs) => fs.writeFile(TEMP_STATE_FILE, JSON.stringify(testState), "utf-8"));

		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await handleState({}, ["clear"], { stateFile: TEMP_STATE_FILE });
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("State file cleared"));
		consoleLogSpy.mockRestore();

		const content = await readFile(TEMP_STATE_FILE, "utf-8");
		const parsed = JSON.parse(content);
		expect(parsed.metadata).toBeDefined();
		expect(parsed.phase).toBe("plan");
		expect(parsed.status).toBe("pending");
	});

	it("should exit with error when state file not found for show", async () => {
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("exit");
		});

		await expect(handleState({}, ["show"], { stateFile: TEMP_STATE_FILE })).rejects.toThrow("exit");
		expect(processExitSpy).toHaveBeenCalledWith(1);
		expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("State file not found"));

		consoleErrorSpy.mockRestore();
		processExitSpy.mockRestore();
	});

	it("should exit with error for unknown state command", async () => {
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("exit");
		});

		await expect(handleState({}, ["unknown"], {})).rejects.toThrow("exit");
		expect(processExitSpy).toHaveBeenCalledWith(2);
		expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown state command"));

		consoleErrorSpy.mockRestore();
		processExitSpy.mockRestore();
	});
});
