import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type BuildStep, buildAgent, parsePlanToSteps } from "./build-agent.js";
import { readStateFile } from "./state.js";
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

describe("buildAgent", () => {
	const tempFile = "/tmp/test-build-state.json";
	const testDir = "/tmp/test-build-agent";

	beforeEach(() => {
		try {
			unlinkSync(tempFile);
		} catch {
			/* ignore */
		}
		try {
			unlinkSync(`${tempFile}.lock`);
		} catch {
			/* ignore */
		}
	});

	afterEach(() => {
		try {
			unlinkSync(tempFile);
		} catch {
			/* ignore */
		}
		try {
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

	it("should return error for empty plan content", async () => {
		const result = await buildAgent("", { stateFilePath: tempFile, verbose: false });
		expect(result.success).toBe(false);
		expect(result.error).toBe("No plan content provided");
	});

	it("should return error for whitespace-only plan content", async () => {
		const result = await buildAgent("   \n\t  \n  ", { stateFilePath: tempFile, verbose: false });
		expect(result.success).toBe(false);
		expect(result.error).toBe("No plan content provided");
	});

	it("should create state file when reading non-existent state", async () => {
		const plan = "# Implementation Plan: Test Task\n\n## Phase 1: Do something\n1. First step";
		const result = await buildAgent(plan, { stateFilePath: tempFile, dryRun: true, verbose: false });

		expect(result.success).toBe(true);
		expect(existsSync(tempFile)).toBe(true);

		const stateResult = await readStateFile(tempFile);
		expect(stateResult.success).toBe(true);
		if (stateResult.data) {
			expect(stateResult.data.phase).toBe("build");
			expect(stateResult.data.status).toBe("completed");
		}
	});

	it("should execute steps in dry-run mode without creating files", async () => {
		const plan = "# Implementation Plan: Test Task\n\n## Phase 1: Create a file\n1. Create test.txt with content";
		const result = await buildAgent(plan, { stateFilePath: tempFile, dryRun: true, verbose: false });

		expect(result.success).toBe(true);
		expect(existsSync(join(testDir, "test.txt"))).toBe(false);
	});

	it("should preserve existing state file taskDescription", async () => {
		const existingState = createTestStateFile({
			taskDescription: "Existing task",
			phase: "plan",
			status: "completed",
		});
		writeFileSync(tempFile, JSON.stringify(existingState, null, 2), "utf-8");

		const plan = "# Implementation Plan: Test Task\n\n## Phase 1: Do something\n1. First step";
		const result = await buildAgent(plan, { stateFilePath: tempFile, dryRun: true, verbose: false });

		expect(result.success).toBe(true);

		const stateResult = await readStateFile(tempFile);
		expect(stateResult.success).toBe(true);
		if (stateResult.data) {
			expect(stateResult.data.taskDescription).toBe("Existing task");
		}
	});

	it("should track step execution in results", async () => {
		const plan =
			"# Implementation Plan: Test Task\n\n## Phase 1: First step\n1. Do something\n\n## Phase 2: Second step\n1. Do another thing";
		const result = await buildAgent(plan, { stateFilePath: tempFile, dryRun: true, verbose: false });

		expect(result.success).toBe(true);
		expect(result.steps).toBeDefined();
		if (result.steps) {
			expect(result.steps.length).toBeGreaterThanOrEqual(2);
		}

		const stateResult = await readStateFile(tempFile);
		expect(stateResult.data?.results.build).toBeDefined();
		if (stateResult.data?.results.build) {
			expect(stateResult.data.results.build.steps.length).toBeGreaterThanOrEqual(2);
		}
	});
});

describe("parsePlanToSteps", () => {
	it("should parse phases from plan content", () => {
		const plan = `# Implementation Plan: Test Task

## Phase 1: First Phase
1. Step 1.1
2. Step 1.2

## Phase 2: Second Phase
1. Step 2.1
2. Step 2.2`;

		const steps = parsePlanToSteps(plan);

		expect(steps.length).toBe(2);
		expect(steps[0]?.stepNumber).toBe(1);
		expect(steps[0]?.description).toBe("First Phase");
		expect(steps[0]?.actions.length).toBe(2);
		expect(steps[1]?.stepNumber).toBe(2);
		expect(steps[1]?.description).toBe("Second Phase");
	});

	it("should parse numbered steps when no phases", () => {
		const plan = `1. First step
2. Second step
3. Third step`;

		const steps = parsePlanToSteps(plan);

		expect(steps.length).toBe(3);
		expect(steps[0]?.stepNumber).toBe(1);
		expect(steps[0]?.description).toBe("First step");
		expect(steps[0]?.actions.length).toBe(1);
		expect(steps[1]?.stepNumber).toBe(2);
		expect(steps[1]?.actions.length).toBe(1);
		expect(steps[2]?.stepNumber).toBe(3);
		expect(steps[2]?.actions.length).toBe(1);
	});

	it("should handle empty plan content", () => {
		const steps = parsePlanToSteps("");
		expect(steps.length).toBe(0);
	});

	it("should handle plan with bullet points", () => {
		const plan = `1. First step
   - Subtask A
   - Subtask B`;

		const steps = parsePlanToSteps(plan);

		expect(steps.length).toBe(1);
		expect(steps[0]?.stepNumber).toBe(1);
		expect(steps[0]?.actions.length).toBe(3);
	});

	it("should handle plan with phases and numbered sub-steps", () => {
		const plan = `## Phase 1: Setup
1. Initialize project
2. Install dependencies

## Phase 2: Development
1. Create components
2. Write tests`;

		const steps = parsePlanToSteps(plan);

		expect(steps.length).toBe(2);
		expect(steps[0]?.description).toBe("Setup");
		expect(steps[0]?.actions.length).toBe(2);
		expect(steps[1]?.description).toBe("Development");
		expect(steps[1]?.actions.length).toBe(2);
	});
});

describe("BuildStep type", () => {
	it("should allow optional status field", () => {
		const step: BuildStep = {
			stepNumber: 1,
			description: "Test step",
			actions: [],
			status: "pending",
		};
		expect(step.status).toBe("pending");
	});

	it("should allow optional changes field", () => {
		const step: BuildStep = {
			stepNumber: 1,
			description: "Test step",
			actions: [],
			changes: [
				{ type: "create", path: "test.txt" },
				{ type: "modify", path: "existing.txt", diff: "old -> new" },
			],
		};
		expect(step.changes?.length).toBe(2);
	});

	it("should allow optional confirmed field", () => {
		const step: BuildStep = {
			stepNumber: 1,
			description: "Test step",
			actions: [],
			confirmed: true,
		};
		expect(step.confirmed).toBe(true);
	});
});
