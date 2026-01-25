import { beforeEach, describe, expect, it } from "bun:test";
import { setConfirmationHandler } from "../../src/tools/confirmation.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import type { Tool, ToolResult } from "../../src/tools/types.js";

// Mock tools for testing
const mockSafeTool: Tool = {
	name: "safe_tool",
	description: "A safe tool that doesn't require confirmation",
	parameters: {
		type: "object",
		properties: { input: { type: "string" } },
		required: ["input"],
	},
	async execute(args): Promise<ToolResult> {
		return { success: true, output: `safe: ${args.input}` };
	},
};

describe("ToolRegistry", () => {
	let registry: ToolRegistry;

	beforeEach(() => {
		registry = new ToolRegistry();
		setConfirmationHandler(undefined);
	});

	const mockDangerousToolBoolean: Tool = {
		name: "dangerous_bool",
		description: "A dangerous tool marked with boolean",
		dangerous: true,
		parameters: {
			type: "object",
			properties: { input: { type: "string" } },
			required: ["input"],
		},
		async execute(args): Promise<ToolResult> {
			return { success: true, output: `dangerous: ${args.input}` };
		},
	};

	const mockDangerousToolString: Tool = {
		name: "dangerous_string",
		description: "A dangerous tool marked with string",
		dangerous: "This will modify important data",
		parameters: {
			type: "object",
			properties: { input: { type: "string" } },
			required: ["input"],
		},
		async execute(args): Promise<ToolResult> {
			return { success: true, output: `dangerous: ${args.input}` };
		},
	};

	const mockDangerousToolFunction: Tool = {
		name: "dangerous_func",
		description: "A dangerous tool with function-based danger check",
		dangerous: (args) => {
			if (args.force === true) {
				return "Force mode enabled - will overwrite";
			}
			return false;
		},
		parameters: {
			type: "object",
			properties: {
				input: { type: "string" },
				force: { type: "boolean" },
			},
			required: ["input"],
		},
		async execute(args): Promise<ToolResult> {
			return { success: true, output: `func: ${args.input}` };
		},
	};

	describe("isDangerous()", () => {
		it("should return false for tools without dangerous property", () => {
			registry.register(mockSafeTool);
			expect(registry.isDangerous("safe_tool", { input: "test" })).toBe(false);
		});

		it("should return true for tools with dangerous: true", () => {
			registry.register(mockDangerousToolBoolean);
			expect(registry.isDangerous("dangerous_bool", { input: "test" })).toBe(true);
		});

		it("should return true for tools with dangerous: string", () => {
			registry.register(mockDangerousToolString);
			expect(registry.isDangerous("dangerous_string", { input: "test" })).toBe(true);
		});

		it("should return false for unknown tools", () => {
			expect(registry.isDangerous("unknown", {})).toBe(false);
		});

		it("should evaluate function-based dangerous property", () => {
			registry.register(mockDangerousToolFunction);

			// force=true should be dangerous
			expect(registry.isDangerous("dangerous_func", { input: "test", force: true })).toBe(true);

			// force=false or undefined should be safe
			expect(registry.isDangerous("dangerous_func", { input: "test", force: false })).toBe(false);
			expect(registry.isDangerous("dangerous_func", { input: "test" })).toBe(false);
		});
	});

	describe("getDangerLevel()", () => {
		it("should return undefined for safe tools", () => {
			registry.register(mockSafeTool);
			expect(registry.getDangerLevel("safe_tool", { input: "test" })).toBeUndefined();
		});

		it("should return undefined for unknown tools", () => {
			expect(registry.getDangerLevel("unknown", {})).toBeUndefined();
		});

		it("should return default message for tools with dangerous: true", () => {
			registry.register(mockDangerousToolBoolean);
			expect(registry.getDangerLevel("dangerous_bool", { input: "test" })).toBe("Execute dangerous_bool");
		});

		it("should return the string for tools with dangerous: string", () => {
			registry.register(mockDangerousToolString);
			expect(registry.getDangerLevel("dangerous_string", { input: "test" })).toBe("This will modify important data");
		});

		it("should return the string result from function-based dangerous", () => {
			registry.register(mockDangerousToolFunction);
			expect(registry.getDangerLevel("dangerous_func", { input: "test", force: true })).toBe(
				"Force mode enabled - will overwrite"
			);
		});

		it("should return default message when function returns true (not string)", () => {
			const tool: Tool = {
				name: "test",
				description: "test",
				dangerous: () => true,
				parameters: { type: "object", properties: {}, required: [] },
				async execute() {
					return { success: true };
				},
			};
			registry.register(tool);
			expect(registry.getDangerLevel("test", {})).toBe("Execute test");
		});

		it("should return undefined when function returns false", () => {
			registry.register(mockDangerousToolFunction);
			expect(registry.getDangerLevel("dangerous_func", { input: "test", force: false })).toBeUndefined();
		});
	});

	describe("executeBatch()", () => {
		it("should execute all tools when no dangerous tools are present", async () => {
			registry.register(mockSafeTool);

			const results = await registry.executeBatch([{ name: "safe_tool", args: { input: "test" } }]);

			expect(results).toHaveLength(1);
			expect(results[0]?.name).toBe("safe_tool");
			expect(results[0]?.result.success).toBe(true);
			expect(results[0]?.result.output).toBe("safe: test");
		});

		it("should execute all tools when no confirmation handler is set", async () => {
			registry.register(mockDangerousToolBoolean);

			const results = await registry.executeBatch([{ name: "dangerous_bool", args: { input: "test" } }]);

			expect(results).toHaveLength(1);
			expect(results[0]?.result.success).toBe(true);
		});

		it("should return error when confirmation handler denies approval", async () => {
			registry.register(mockDangerousToolBoolean);

			setConfirmationHandler(async () => false);

			const results = await registry.executeBatch([{ name: "dangerous_bool", args: { input: "test" } }]);

			expect(results).toHaveLength(1);
			expect(results[0]?.result.success).toBe(false);
			expect(results[0]?.result.error).toBe("User declined confirmation");
		});

		it("should execute when confirmation handler approves", async () => {
			registry.register(mockDangerousToolBoolean);

			setConfirmationHandler(async () => true);

			const results = await registry.executeBatch([{ name: "dangerous_bool", args: { input: "test" } }]);

			expect(results).toHaveLength(1);
			expect(results[0]?.result.success).toBe(true);
			expect(results[0]?.result.output).toBe("dangerous: test");
		});

		it("should handle mixed safe and dangerous tools with approval", async () => {
			registry.register(mockSafeTool);
			registry.register(mockDangerousToolBoolean);

			setConfirmationHandler(async () => true);

			const results = await registry.executeBatch([
				{ name: "safe_tool", args: { input: "safe" } },
				{ name: "dangerous_bool", args: { input: "dangerous" } },
			]);

			expect(results).toHaveLength(2);
			expect(results[0]?.result.success).toBe(true);
			expect(results[1]?.result.success).toBe(true);
		});

		it("should filter only dangerous tools for confirmation", async () => {
			registry.register(mockSafeTool);
			registry.register(mockDangerousToolBoolean);

			let confirmedTools: string[] = [];
			setConfirmationHandler(async (request) => {
				confirmedTools = request.actions.map((a) => a.tool);
				return true;
			});

			await registry.executeBatch([
				{ name: "safe_tool", args: { input: "safe" } },
				{ name: "dangerous_bool", args: { input: "dangerous" } },
			]);

			// Only the dangerous tool should be in the confirmation request
			expect(confirmedTools).toEqual(["dangerous_bool"]);
		});

		it("should return error for unknown tools", async () => {
			const results = await registry.executeBatch([{ name: "unknown", args: {} }]);

			expect(results).toHaveLength(1);
			expect(results[0]?.result.success).toBe(false);
			expect(results[0]?.result.error).toContain('Tool "unknown" not found');
		});

		it("should handle partial approval from confirmation handler", async () => {
			registry.register(mockDangerousToolBoolean);

			setConfirmationHandler(async () => ({ type: "partial", selectedIndex: 0 }));

			const results = await registry.executeBatch([{ name: "dangerous_bool", args: { input: "test" } }]);

			// With selectedIndex: 0, the dangerous_bool should execute
			expect(results).toHaveLength(1);
			expect(results[0]?.result.success).toBe(true);
			expect(results[0]?.result.output).toBe("dangerous: test");
		});

		it("should mark non-selected tools as declined in partial approval", async () => {
			registry.register(mockDangerousToolBoolean);
			registry.register(mockDangerousToolString);

			setConfirmationHandler(async () => ({ type: "partial", selectedIndex: 0 }));

			const results = await registry.executeBatch([
				{ name: "dangerous_bool", args: { input: "test1" } },
				{ name: "dangerous_string", args: { input: "test2" } },
			]);

			expect(results).toHaveLength(2);
			expect(results[0]?.result.success).toBe(true);
			expect(results[1]?.result.success).toBe(false);
			expect(results[1]?.result.error).toBe("User declined confirmation");
		});

		it("should execute safe tools even in partial approval", async () => {
			registry.register(mockSafeTool);
			registry.register(mockDangerousToolBoolean);

			setConfirmationHandler(async () => ({ type: "partial", selectedIndex: 0 }));

			const results = await registry.executeBatch([
				{ name: "safe_tool", args: { input: "safe" } },
				{ name: "dangerous_bool", args: { input: "dangerous" } },
			]);

			// Both tools should execute - safe_tool is not dangerous, dangerous_bool is selected
			expect(results).toHaveLength(2);
			expect(results[0]?.result.success).toBe(true);
			expect(results[1]?.result.success).toBe(true);
		});

		it("should execute multiple tools in parallel", async () => {
			registry.register(mockSafeTool);

			const executionOrder: string[] = [];
			const trackingTool: Tool = {
				name: "tracking",
				description: "Tracks execution order",
				parameters: {
					type: "object",
					properties: { id: { type: "string" } },
					required: ["id"],
				},
				async execute(args) {
					executionOrder.push(args.id as string);
					// Small delay to test parallel execution
					await new Promise((resolve) => setTimeout(resolve, 10));
					return { success: true, output: String(args.id) };
				},
			};
			registry.register(trackingTool);

			await registry.executeBatch([
				{ name: "tracking", args: { id: "1" } },
				{ name: "tracking", args: { id: "2" } },
				{ name: "tracking", args: { id: "3" } },
			]);

			// All should be executed (order doesn't matter due to parallel execution)
			expect(executionOrder).toHaveLength(3);
			expect(executionOrder).toContain("1");
			expect(executionOrder).toContain("2");
			expect(executionOrder).toContain("3");
		});
	});
});
