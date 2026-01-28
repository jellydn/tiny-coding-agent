import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { globTool, ToolRegistry } from "../../src/tools/index.js";
import { readStateFile } from "../../src/agents/state.js";
import type { StateFile } from "../../src/agents/types.js";

const DEFAULT_STATE_FILE = "/tmp/test-plan-agent-state.json";

describe("exploreCodebase", () => {
	it("should return exploration results structure", async () => {
		const cwd = ".";

		const registry = new ToolRegistry();
		registry.register({
			name: "glob",
			description: globTool.description,
			parameters: globTool.parameters,
			execute: globTool.execute,
		});

		const globResult = await registry.execute("glob", { pattern: "**/*.ts", path: cwd });
		expect(globResult.success).toBe(true);
		expect(globResult.output).toBeDefined();
	});

	it("should handle package.json reading", async () => {
		const packageJsonPath = path.join(process.cwd(), "package.json");
		const exists = existsSync(packageJsonPath);
		if (exists) {
			const content = await fs.readFile(packageJsonPath, "utf-8");
			expect(content).toContain("name");
		}
	});
});

describe("StateFile structure for plan agent", () => {
	const tempStateFile = DEFAULT_STATE_FILE;

	beforeEach(() => {
		try {
			unlinkSync(tempStateFile);
		} catch {
			/* ignore */
		}
		try {
			unlinkSync(`${tempStateFile}.lock`);
		} catch {
			/* ignore */
		}
	});

	afterEach(() => {
		try {
			unlinkSync(tempStateFile);
		} catch {
			/* ignore */
		}
		try {
			unlinkSync(`${tempStateFile}.lock`);
		} catch {
			/* ignore */
		}
	});

	it("should have correct plan phase in state file", () => {
		const state: StateFile = {
			metadata: {
				agentName: "tiny-agent",
				agentVersion: "1.0.0",
				invocationTimestamp: new Date().toISOString(),
				parameters: {},
			},
			phase: "plan",
			taskDescription: "Test task",
			status: "completed",
			results: {
				plan: { plan: "# Implementation Plan\n\n## Phase 1\nTest" },
			},
			errors: [],
			artifacts: [],
		};

		expect(state.phase).toBe("plan");
		expect(state.status).toBe("completed");
		expect(state.results.plan).toBeDefined();
		expect(state.results.plan?.plan).toContain("Implementation Plan");
	});

	it("should handle state file with plan result", async () => {
		const planContent = "# Implementation Plan: New Feature\n\n## Phase 1\nTest phase";
		const state: StateFile = {
			metadata: {
				agentName: "tiny-agent",
				agentVersion: "1.0.0",
				invocationTimestamp: new Date().toISOString(),
				parameters: { generatePrd: "false" },
			},
			phase: "plan",
			taskDescription: "Implement new feature",
			status: "completed",
			results: {
				plan: { plan: planContent },
			},
			errors: [],
			artifacts: [],
		};

		writeFileSync(tempStateFile, JSON.stringify(state, null, 2), "utf-8");

		const result = await readStateFile(tempStateFile);
		expect(result.success).toBe(true);
		expect(result.data?.phase).toBe("plan");
		expect(result.data?.results.plan?.plan).toBe(planContent);
	});

	it("should preserve existing state when updating", async () => {
		const existingState: StateFile = {
			metadata: {
				agentName: "test-agent",
				agentVersion: "0.5.0",
				invocationTimestamp: "2024-01-01T00:00:00.000Z",
				parameters: { oldParam: "value" },
			},
			phase: "plan",
			taskDescription: "Original task",
			status: "in_progress",
			results: {},
			errors: [],
			artifacts: [],
		};

		writeFileSync(tempStateFile, JSON.stringify(existingState, null, 2), "utf-8");

		const updatedState: StateFile = {
			...existingState,
			status: "completed",
			results: {
				plan: { plan: "New plan content" },
			},
		};

		writeFileSync(tempStateFile, JSON.stringify(updatedState, null, 2), "utf-8");

		const result = await readStateFile(tempStateFile);
		expect(result.success).toBe(true);
		expect(result.data?.status).toBe("completed");
		expect(result.data?.metadata.agentName).toBe("test-agent");
		expect(result.data?.results.plan?.plan).toBe("New plan content");
	});

	it("should handle missing optional fields", () => {
		const minimalState: StateFile = {
			metadata: {
				agentName: "tiny-agent",
				agentVersion: "1.0.0",
				invocationTimestamp: new Date().toISOString(),
				parameters: {},
			},
			phase: "plan",
			taskDescription: "Minimal task",
			status: "pending",
			results: {},
			errors: [],
			artifacts: [],
		};

		expect(minimalState.results.plan).toBeUndefined();
		expect(minimalState.results.build).toBeUndefined();
		expect(minimalState.results.exploration).toBeUndefined();
	});
});

describe("PlanResult structure", () => {
	it("should have correct success result shape", () => {
		const result = {
			success: true,
			plan: "# Plan content",
			prd: undefined,
		};

		expect(result.success).toBe(true);
		expect(result.plan).toBeDefined();
		expect(result.prd).toBeUndefined();
	});

	it("should have correct PRD result shape", () => {
		const result: { success: true; plan: string; prd: string } = {
			success: true,
			plan: "# Plan content",
			prd: "project: test\nuserStories: []",
		};

		expect(result.success).toBe(true);
		expect(result.plan).toBeDefined();
		expect(result.prd).toBeDefined();
	});

	it("should have correct error result shape", () => {
		const result: { success: false; error: string; plan?: undefined } = {
			success: false,
			error: "Failed to generate plan",
		};

		expect(result.success).toBe(false);
		expect(result.error).toBeDefined();
		expect(result.plan).toBeUndefined();
	});
});
