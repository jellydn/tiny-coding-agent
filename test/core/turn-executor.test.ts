import { beforeEach, describe, expect, it, vi } from "bun:test";
import { type AssistantToolCall, TurnExecutor } from "../../src/core/turn-executor.js";
import { ToolRegistry } from "../../src/tools/registry.js";

// Mock tool that always succeeds
const successTool = {
	name: "success_tool",
	description: "A tool that always succeeds",
	parameters: { type: "object" as const, properties: {}, required: [] },
	execute: async () => ({ success: true, output: "done" }),
};

// Mock tool that always fails with "not found"
const notFoundTool = {
	name: "not_found_tool",
	description: "A tool that returns not found",
	parameters: { type: "object" as const, properties: {}, required: [] },
	execute: async () => ({ success: false, error: "Tool not found" }),
};

// Mock tool that always fails with "User declined confirmation"
const declinedTool = {
	name: "declined_tool",
	description: "A tool that is declined by the user",
	parameters: { type: "object" as const, properties: {}, required: [] },
	execute: async () => ({ success: false, error: "User declined confirmation" }),
};

// Mock tool that fails with a generic error
const errorTool = {
	name: "error_tool",
	description: "A tool that fails with a generic error",
	parameters: { type: "object" as const, properties: {}, required: [] },
	execute: async () => ({ success: false, error: "Something went wrong" }),
};

describe("TurnExecutor", () => {
	let registry: ToolRegistry;

	beforeEach(() => {
		registry = new ToolRegistry();
		registry.register(successTool);
		registry.register(notFoundTool);
		registry.register(declinedTool);
		registry.register(errorTool);
	});

	describe("executeTurn()", () => {
		it("should execute a successful tool call and return complete status", async () => {
			const executor = new TurnExecutor(registry);
			const calls: AssistantToolCall[] = [{ id: "1", name: "success_tool", arguments: {} }];

			const result = await executor.executeTurn(calls);

			expect(result.toolExecutions).toHaveLength(1);
			expect(result.toolExecutions[0]?.status).toBe("complete");
			expect(result.toolExecutions[0]?.output).toBe("done");
			expect(result.loopBreakReason).toBeNull();
			expect(result.shouldContinue).toBe(true);
			expect(result.toolResultMessages).toHaveLength(1);
			expect(result.toolResultMessages[0]?.content).toBe("done");
			expect(result.toolResultMessages[0]?.toolCallId).toBe("1");
		});

		it("should detect not-found errors and break the loop", async () => {
			const executor = new TurnExecutor(registry);
			const calls: AssistantToolCall[] = [{ id: "1", name: "not_found_tool", arguments: {} }];

			const result = await executor.executeTurn(calls);

			expect(result.loopBreakReason).toBe("not_found");
			expect(result.shouldContinue).toBe(false);
			expect(result.systemMessages).toHaveLength(1);
			expect(result.systemMessages[0]?.content).toContain("not available");
			expect(result.systemMessages[0]?.content).toContain("not_found_tool");
		});

		it("should detect all-declined and break the loop", async () => {
			const executor = new TurnExecutor(registry);
			const calls: AssistantToolCall[] = [
				{ id: "1", name: "declined_tool", arguments: {} },
				{ id: "2", name: "declined_tool", arguments: {} },
			];

			const result = await executor.executeTurn(calls);

			expect(result.loopBreakReason).toBe("all_declined");
			expect(result.shouldContinue).toBe(false);
			expect(result.systemMessages).toHaveLength(1);
			expect(result.systemMessages[0]?.content).toContain("declined by the user");
		});

		it("should continue when some tools are declined but others succeed", async () => {
			const executor = new TurnExecutor(registry);
			const calls: AssistantToolCall[] = [
				{ id: "1", name: "success_tool", arguments: {} },
				{ id: "2", name: "declined_tool", arguments: {} },
			];

			const result = await executor.executeTurn(calls);

			expect(result.loopBreakReason).toBeNull();
			expect(result.shouldContinue).toBe(true);
			expect(result.systemMessages).toHaveLength(0);
			expect(result.toolExecutions).toHaveLength(2);
		});

		it("should detect tool-call loops after 3 identical calls", async () => {
			const executor = new TurnExecutor(registry);
			const calls: AssistantToolCall[] = [{ id: "1", name: "success_tool", arguments: { task: "same" } }];

			// Execute 3 times with the same call
			await executor.executeTurn(calls);
			await executor.executeTurn(calls);
			const result = await executor.executeTurn(calls);

			expect(result.loopBreakReason).toBe("loop_detected");
			expect(result.shouldContinue).toBe(false);
			expect(result.systemMessages).toHaveLength(1);
			expect(result.systemMessages[0]?.content).toContain("STOP");
			expect(result.systemMessages[0]?.content).toContain("success_tool");
		});

		it("should not detect a loop with fewer than 3 calls", async () => {
			const executor = new TurnExecutor(registry);
			const calls: AssistantToolCall[] = [{ id: "1", name: "success_tool", arguments: { task: "same" } }];

			await executor.executeTurn(calls);
			const result = await executor.executeTurn(calls);

			expect(result.loopBreakReason).toBeNull();
			expect(result.shouldContinue).toBe(true);
		});

		it("should handle a tool that returns a generic error (not not-found, not declined)", async () => {
			const executor = new TurnExecutor(registry);
			const calls: AssistantToolCall[] = [{ id: "1", name: "error_tool", arguments: {} }];

			const result = await executor.executeTurn(calls);

			expect(result.toolExecutions[0]?.status).toBe("error");
			expect(result.toolExecutions[0]?.error).toBe("Something went wrong");
			expect(result.loopBreakReason).toBeNull();
			expect(result.shouldContinue).toBe(true);
		});

		it("should handle multiple tool calls in one turn", async () => {
			const executor = new TurnExecutor(registry);
			const calls: AssistantToolCall[] = [
				{ id: "1", name: "success_tool", arguments: {} },
				{ id: "2", name: "success_tool", arguments: { task: "other" } },
			];

			const result = await executor.executeTurn(calls);

			expect(result.toolExecutions).toHaveLength(2);
			expect(result.toolExecutions.every((te) => te.status === "complete")).toBe(true);
			expect(result.toolResultMessages).toHaveLength(2);
			expect(result.shouldContinue).toBe(true);
		});

		it("should include duration in the tool execution display", async () => {
			const executor = new TurnExecutor(registry);
			const calls: AssistantToolCall[] = [{ id: "1", name: "success_tool", arguments: {} }];

			const result = await executor.executeTurn(calls);

			expect(result.toolExecutions[0]?.duration).toBeDefined();
			expect(typeof result.toolExecutions[0]?.duration).toBe("number");
		});

		it("should handle tool result not found in batch results", async () => {
			const executor = new TurnExecutor(registry);
			// Call a tool that doesn't exist in the registry
			const calls: AssistantToolCall[] = [{ id: "1", name: "nonexistent_tool", arguments: {} }];

			const result = await executor.executeTurn(calls);

			expect(result.toolExecutions[0]?.status).toBe("error");
			// The registry returns an error for unknown tools — either "not found" or a generic error
			expect(result.toolExecutions[0]?.error).toBeDefined();
		});
	});

	describe("reset()", () => {
		it("should clear the recent tool call history", async () => {
			const executor = new TurnExecutor(registry);
			const calls: AssistantToolCall[] = [{ id: "1", name: "success_tool", arguments: { task: "same" } }];

			// Execute twice to build up history
			await executor.executeTurn(calls);
			await executor.executeTurn(calls);

			// Reset
			executor.reset();

			// Execute again — should not detect a loop (history was cleared)
			const result = await executor.executeTurn(calls);
			expect(result.loopBreakReason).toBeNull();
			expect(result.shouldContinue).toBe(true);
		});
	});

	describe("runningDisplay()", () => {
		it("should build running display objects for the UI", () => {
			const calls: AssistantToolCall[] = [
				{ id: "1", name: "success_tool", arguments: { foo: "bar" } },
				{ id: "2", name: "error_tool", arguments: {} },
			];

			const display = TurnExecutor.runningDisplay(calls);

			expect(display).toHaveLength(2);
			expect(display[0]?.name).toBe("success_tool");
			expect(display[0]?.status).toBe("running");
			expect(display[0]?.args).toEqual({ foo: "bar" });
			expect(display[0]?.startTime).toBeDefined();
			expect(display[1]?.name).toBe("error_tool");
			expect(display[1]?.status).toBe("running");
		});

		it("should return empty array for no tool calls", () => {
			const display = TurnExecutor.runningDisplay([]);
			expect(display).toEqual([]);
		});
	});

	describe("verbose mode", () => {
		it("should log warnings in verbose mode for not-found errors", async () => {
			const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			const executor = new TurnExecutor(registry, { verbose: true });
			const calls: AssistantToolCall[] = [{ id: "1", name: "not_found_tool", arguments: {} }];

			await executor.executeTurn(calls);

			expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("not found"));

			consoleLogSpy.mockRestore();
		});

		it("should log info in verbose mode for declined tools", async () => {
			const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			const executor = new TurnExecutor(registry, { verbose: true });
			const calls: AssistantToolCall[] = [{ id: "1", name: "declined_tool", arguments: {} }];

			await executor.executeTurn(calls);

			expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("declined"));

			consoleLogSpy.mockRestore();
		});
	});
});
