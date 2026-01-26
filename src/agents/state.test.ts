import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { readStateFile, writeStateFile } from "./state.js";
import type { StateFile, StateMetadata } from "./types.js";

function createTestStateFile(overrides: Partial<StateFile> = {}): StateFile {
	const metadata: StateMetadata = {
		agentName: "test-agent",
		agentVersion: "1.0.0",
		invocationTimestamp: new Date().toISOString(),
		parameters: {},
	};

	return {
		metadata,
		phase: "plan",
		taskDescription: "Test task",
		status: "pending",
		results: {},
		errors: [],
		artifacts: [],
		...overrides,
	};
}

describe("readStateFile", () => {
	const tempFile = "/tmp/test-state-file.json";

	beforeEach(() => {
		try {
			unlinkSync(tempFile);
		} catch {
			/* ignore */
		}
	});

	afterEach(() => {
		try {
			unlinkSync(tempFile);
			unlinkSync(`${tempFile}.lock`);
		} catch {
			/* ignore */
		}
	});

	it("should return error for non-existent file", async () => {
		const result = await readStateFile(tempFile);
		expect(result.success).toBe(false);
		expect(result.error).toContain("not found");
	});

	it("should read valid state file", async () => {
		const state = createTestStateFile({ taskDescription: "My test task" });
		writeFileSync(tempFile, JSON.stringify(state, null, 2), "utf-8");

		const result = await readStateFile(tempFile);
		expect(result.success).toBe(true);
		expect(result.data).toBeDefined();
		expect(result.data?.taskDescription).toBe("My test task");
	});

	it("should return error for invalid JSON", async () => {
		writeFileSync(tempFile, "not valid json", "utf-8");

		const result = await readStateFile(tempFile);
		expect(result.success).toBe(false);
		expect(result.error).toContain("Invalid JSON");
	});

	it("should return error for invalid state file format", async () => {
		writeFileSync(tempFile, JSON.stringify({ foo: "bar" }), "utf-8");

		const result = await readStateFile(tempFile);
		expect(result.success).toBe(false);
		expect(result.error).toContain("Invalid state file format");
	});
});

describe("writeStateFile", () => {
	const tempFile = "/tmp/test-state-file-write.json";

	afterEach(() => {
		try {
			unlinkSync(tempFile);
			unlinkSync(`${tempFile}.lock`);
		} catch {
			/* ignore */
		}

		for (let i = 1; i <= 5; i++) {
			try {
				unlinkSync(`${tempFile}.${i}`);
			} catch {
				/* ignore */
			}
		}
	});

	it("should write state file atomically", async () => {
		const state = createTestStateFile({ taskDescription: "Write test" });

		const result = await writeStateFile(tempFile, state);
		expect(result.success).toBe(true);
		expect(existsSync(tempFile)).toBe(true);

		const readResult = await readStateFile(tempFile);
		expect(readResult.success).toBe(true);
		expect(readResult.data?.taskDescription).toBe("Write test");
	});

	it("should handle concurrent writes gracefully", async () => {
		const state1 = createTestStateFile({ taskDescription: "First write" });
		const state2 = createTestStateFile({ taskDescription: "Second write" });

		const [result1, result2] = await Promise.all([writeStateFile(tempFile, state1), writeStateFile(tempFile, state2)]);

		expect(result1.success).toBe(true);
		expect(result2.success).toBe(true);

		const readResult = await readStateFile(tempFile);
		expect(readResult.success).toBe(true);
		expect(["First write", "Second write"]).toContain(readResult.data!.taskDescription);
	});

	it("should clean up temp file on error", async () => {
		const tempInvalidPath = "/nonexistent/path/state.json";
		const state = createTestStateFile();

		const result = await writeStateFile(tempInvalidPath, state);
		expect(result.success).toBe(false);
		expect(result.error).toContain("Failed to acquire lock");
	});
});

describe("state file rotation", () => {
	const tempFile = "/tmp/test-state-rotate.json";

	afterEach(() => {
		try {
			unlinkSync(tempFile);
			unlinkSync(`${tempFile}.lock`);
		} catch {
			/* ignore */
		}

		for (let i = 1; i <= 5; i++) {
			try {
				unlinkSync(`${tempFile}.${i}`);
			} catch {
				/* ignore */
			}
		}
	});

	it("should rotate files when size exceeds limit", async () => {
		const largeContent = { data: "x".repeat(11 * 1024 * 1024) };
		writeFileSync(tempFile, JSON.stringify(largeContent), "utf-8");

		const state = createTestStateFile({ taskDescription: "After rotation" });
		const result = await writeStateFile(tempFile, state);

		expect(result.success).toBe(true);
		expect(existsSync(`${tempFile}.1`)).toBe(true);
		expect(existsSync(tempFile)).toBe(true);

		const readResult = await readStateFile(tempFile);
		expect(readResult.data?.taskDescription).toBe("After rotation");
	});
});
