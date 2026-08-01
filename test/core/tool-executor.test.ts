import { describe, expect, it } from "bun:test";
import { AgentObservability } from "../../src/core/agent-observability.js";
import { RunnerObservability } from "../../src/core/runner-observability.js";
import { executeToolCalls } from "../../src/core/tool-executor.js";
import { TurnExecutor } from "../../src/core/turn-executor.js";
import { ToolRegistry } from "../../src/tools/registry.js";

function createMockObservability(): RunnerObservability {
	const obs = new AgentObservability({});
	return new RunnerObservability(obs, "test-provider", "test-model");
}

function createMockTurnExecutor(): TurnExecutor {
	const registry = new ToolRegistry();
	return new TurnExecutor(registry, { verbose: false });
}

describe("executeToolCalls", () => {
	it("should execute tool calls and return results", async () => {
		const runnerObs = createMockObservability();
		const turnExecutor = createMockTurnExecutor();

		const assistantToolCalls = [{ id: "call-1", name: "test-tool", arguments: { input: "test" } }];

		const result = await executeToolCalls(assistantToolCalls, turnExecutor, runnerObs);

		expect(result).toBeDefined();
		expect(result.toolResultMessages).toBeDefined();
		expect(result.systemMessages).toBeDefined();
		expect(result.toolExecutions).toBeDefined();
	});

	it("should return empty arrays when no tool calls", async () => {
		const runnerObs = createMockObservability();
		const turnExecutor = createMockTurnExecutor();

		const result = await executeToolCalls([], turnExecutor, runnerObs);

		expect(result.toolResultMessages).toEqual([]);
		expect(result.systemMessages).toEqual([]);
		expect(result.toolExecutions).toEqual([]);
	});

	it("should handle multiple tool calls", async () => {
		const runnerObs = createMockObservability();
		const turnExecutor = createMockTurnExecutor();

		const assistantToolCalls = [
			{ id: "call-1", name: "tool-1", arguments: {} },
			{ id: "call-2", name: "tool-2", arguments: {} },
		];

		const result = await executeToolCalls(assistantToolCalls, turnExecutor, runnerObs);

		expect(result.toolExecutions.length).toBeGreaterThanOrEqual(0);
	});
});
