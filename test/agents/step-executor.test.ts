import { beforeEach, describe, expect, it, vi } from "bun:test";
import type { BuildStep } from "../../src/agents/build-agent.js";
import { mapBuildAction, StepExecutor } from "../../src/agents/step-executor.js";
import { ToolRegistry } from "../../src/tools/registry.js";

// Mock write_file tool for change tracking
const writeFileTool = {
	name: "write_file",
	description: "Write a file",
	parameters: { type: "object" as const, properties: {}, required: [] },
	execute: async () => ({ success: true, output: "File written" }),
};

// Mock edit_file tool for change tracking
const editFileTool = {
	name: "edit_file",
	description: "Edit a file",
	parameters: { type: "object" as const, properties: {}, required: [] },
	execute: async () => ({ success: true, output: "File edited" }),
};

// Mock delete_file tool for change tracking
const deleteFileTool = {
	name: "delete_file",
	description: "Delete a file",
	parameters: { type: "object" as const, properties: {}, required: [] },
	execute: async () => ({ success: true, output: "File deleted" }),
};

// Command-aware bash mock:
// - "fail" → always fails
// - "flaky" → fails on first call, succeeds on retry
// - anything else → succeeds
let bashFlakyCallCount = 0;

const bashTool = {
	name: "bash",
	description: "Run a bash command",
	parameters: { type: "object" as const, properties: {}, required: [] },
	execute: async (args: Record<string, unknown>) => {
		const command = String(args?.command ?? "");
		if (command === "flaky") {
			bashFlakyCallCount++;
			if (bashFlakyCallCount === 1) {
				return { success: false, error: "Transient error" };
			}
			return { success: true, output: "Success on retry" };
		}
		if (command === "fail") {
			return { success: false, error: "Something went wrong" };
		}
		return { success: true, output: "Command executed" };
	},
};

/** Helper: create a StepExecutor with a mocked prompt function. */
function makeExecutor(registry: ToolRegistry, decision: string): StepExecutor {
	const mockPrompt = vi.fn<(q: string, opts: string[]) => Promise<string | null>>().mockResolvedValue(decision);
	return new StepExecutor(registry, { promptFn: mockPrompt });
}

describe("StepExecutor", () => {
	let registry: ToolRegistry;

	beforeEach(() => {
		registry = new ToolRegistry();
		registry.register(writeFileTool);
		registry.register(editFileTool);
		registry.register(deleteFileTool);
		registry.register(bashTool);
		bashFlakyCallCount = 0;
	});

	describe("executeStep()", () => {
		it("should complete successfully when all actions succeed", async () => {
			const executor = new StepExecutor(registry);
			const step: BuildStep = {
				stepNumber: 1,
				description: "Create a file",
				actions: [{ type: "execute", description: "echo hello" }],
			};

			const result = await executor.executeStep(step);

			expect(result.status).toBe("completed");
			expect(result.shouldAbort).toBe(false);
			expect(result.error).toBeUndefined();
		});

		it("should track file changes for create actions", async () => {
			const executor = new StepExecutor(registry);
			const step: BuildStep = {
				stepNumber: 1,
				description: "Create a file",
				actions: [{ type: "create", path: "/tmp/test.ts", content: "hello", description: "Create test.ts" }],
			};

			const result = await executor.executeStep(step);

			expect(result.status).toBe("completed");
			expect(result.changes).toHaveLength(1);
			expect(result.changes[0]?.type).toBe("create");
			expect(result.changes[0]?.path).toBe("/tmp/test.ts");
		});

		it("should track file changes for modify actions", async () => {
			const executor = new StepExecutor(registry);
			const step: BuildStep = {
				stepNumber: 1,
				description: "Modify a file",
				actions: [
					{ type: "modify", path: "/tmp/test.ts", oldContent: "old", content: "new", description: "Modify test.ts" },
				],
			};

			const result = await executor.executeStep(step);

			expect(result.status).toBe("completed");
			expect(result.changes).toHaveLength(1);
			expect(result.changes[0]?.type).toBe("modify");
			expect(result.changes[0]?.path).toBe("/tmp/test.ts");
		});

		it("should track file changes for delete actions", async () => {
			const executor = new StepExecutor(registry);
			const step: BuildStep = {
				stepNumber: 1,
				description: "Delete a file",
				actions: [{ type: "delete", path: "/tmp/test.ts", description: "Delete test.ts" }],
			};

			const result = await executor.executeStep(step);

			expect(result.status).toBe("completed");
			expect(result.changes).toHaveLength(1);
			expect(result.changes[0]?.type).toBe("delete");
			expect(result.changes[0]?.path).toBe("/tmp/test.ts");
		});

		it("should not track changes for execute actions (no path)", async () => {
			const executor = new StepExecutor(registry);
			const step: BuildStep = {
				stepNumber: 1,
				description: "Run a command",
				actions: [{ type: "execute", description: "echo hello" }],
			};

			const result = await executor.executeStep(step);

			expect(result.status).toBe("completed");
			expect(result.changes).toHaveLength(0);
		});

		it("should handle multiple actions in one step", async () => {
			const executor = new StepExecutor(registry);
			const step: BuildStep = {
				stepNumber: 1,
				description: "Multi-action step",
				actions: [
					{ type: "create", path: "/tmp/a.ts", content: "a", description: "Create a.ts" },
					{ type: "create", path: "/tmp/b.ts", content: "b", description: "Create b.ts" },
					{ type: "execute", description: "echo hello" },
				],
			};

			const result = await executor.executeStep(step);

			expect(result.status).toBe("completed");
			expect(result.changes).toHaveLength(2);
		});

		it("should return unmappable error for create action without path", async () => {
			const executor = makeExecutor(registry, "skip");
			const step: BuildStep = {
				stepNumber: 1,
				description: "Bad action",
				actions: [{ type: "create", content: "content", description: "Create without path" }],
			};

			const result = await executor.executeStep(step);

			expect(result.status).toBe("skipped");
			expect(result.error).toContain("requires a path");
		});

		it("should abort when user chooses abort after failure", async () => {
			const executor = makeExecutor(registry, "abort");
			const step: BuildStep = {
				stepNumber: 1,
				description: "Failing step",
				actions: [{ type: "execute", description: "fail" }],
			};

			const result = await executor.executeStep(step);

			expect(result.shouldAbort).toBe(true);
			expect(result.status).toBe("failed");
		});

		it("should skip when user chooses skip after failure", async () => {
			const executor = makeExecutor(registry, "skip");
			const step: BuildStep = {
				stepNumber: 1,
				description: "Failing step",
				actions: [{ type: "execute", description: "fail" }],
			};

			const result = await executor.executeStep(step);

			expect(result.status).toBe("skipped");
			expect(result.shouldAbort).toBe(false);
			expect(result.error).toBeDefined();
		});

		it("should retry successfully when user chooses retry", async () => {
			const executor = makeExecutor(registry, "retry");
			const step: BuildStep = {
				stepNumber: 1,
				description: "Flaky step",
				actions: [{ type: "execute", description: "flaky" }],
			};

			const result = await executor.executeStep(step);

			expect(result.status).toBe("completed");
			expect(result.shouldAbort).toBe(false);
		});

		it("should fail when retry also fails", async () => {
			const executor = makeExecutor(registry, "retry");
			const step: BuildStep = {
				stepNumber: 1,
				description: "Always failing step",
				actions: [{ type: "execute", description: "fail" }],
			};

			const result = await executor.executeStep(step);

			expect(result.status).toBe("failed");
			expect(result.error).toBeDefined();
		});
	});

	describe("mapBuildAction()", () => {
		it("should map execute actions to bash tool calls", () => {
			const result = mapBuildAction({ type: "execute", description: "npm test" });
			expect(result.kind).toBe("call");
			if (result.kind === "call") {
				expect(result.call.name).toBe("bash");
			}
		});

		it("should map create actions to write_file tool calls", () => {
			const result = mapBuildAction({
				type: "create",
				path: "/tmp/test.ts",
				content: "hello",
				description: "Create test.ts",
			});
			expect(result.kind).toBe("call");
			if (result.kind === "call") {
				expect(result.call.name).toBe("write_file");
			}
		});

		it("should return unmappable for create without path", () => {
			const result = mapBuildAction({ type: "create", content: "hello", description: "No path" });
			expect(result.kind).toBe("unmappable");
			if (result.kind === "unmappable") {
				expect(result.reason).toContain("requires a path");
			}
		});
	});
});
