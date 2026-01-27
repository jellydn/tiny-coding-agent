import { beforeEach, describe, expect, it, vi } from "bun:test";
import * as stateModule from "../../agents/state.js";
import { handlePlan } from "./plan.js";

describe("handlePlan", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("should exit with error when no subcommand provided", async () => {
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("exit");
		});

		await expect(handlePlan({}, [], {})).rejects.toThrow("exit");
		expect(processExitSpy).toHaveBeenCalledWith(2);
		expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("requires a subcommand"));

		consoleErrorSpy.mockRestore();
		processExitSpy.mockRestore();
	});

	it("should exit with error when state file not found", async () => {
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("exit");
		});
		vi.spyOn(stateModule, "readStateFile").mockResolvedValue({
			success: false,
			error: "State file not found: .tiny-state.json",
		});

		await expect(handlePlan({}, ["show"], {})).rejects.toThrow("exit");
		expect(processExitSpy).toHaveBeenCalledWith(1);
		expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Error reading state file"));

		consoleErrorSpy.mockRestore();
		processExitSpy.mockRestore();
	});

	it("should show plan from state file", async () => {
		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(stateModule, "readStateFile").mockResolvedValue({
			success: true,
			data: {
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
					plan: { plan: "# Test Plan\n\n## Phase 1: Test\n1. Test step" },
				},
				errors: [],
				artifacts: [],
			},
		});

		await handlePlan({}, ["show"], { stateFile: "/tmp/test-state.json" });

		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("PLAN"));
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Test Plan"));

		consoleLogSpy.mockRestore();
	});

	it("should show message when no plan exists", async () => {
		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(stateModule, "readStateFile").mockResolvedValue({
			success: true,
			data: {
				metadata: {
					agentName: "tiny-agent",
					agentVersion: "1.0.0",
					invocationTimestamp: new Date().toISOString(),
					parameters: {},
				},
				phase: "plan",
				taskDescription: "Test task",
				status: "pending",
				results: {},
				errors: [],
				artifacts: [],
			},
		});

		await handlePlan({}, ["show"], { stateFile: "/tmp/test-state.json" });

		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("No plan found"));

		consoleLogSpy.mockRestore();
	});

	it("should output plan as JSON when --json flag is set", async () => {
		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(stateModule, "readStateFile").mockResolvedValue({
			success: true,
			data: {
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
					plan: { plan: "# Test Plan\n\n## Phase 1: Test\n1. Test step" },
				},
				errors: [],
				artifacts: [],
			},
		});

		await handlePlan({}, ["show"], { stateFile: "/tmp/test-state.json", json: true });

		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('"plan"'));
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Test Plan"));

		consoleLogSpy.mockRestore();
	});

	it("should list all tasks with status", async () => {
		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(stateModule, "readStateFile").mockResolvedValue({
			success: true,
			data: {
				metadata: {
					agentName: "tiny-agent",
					agentVersion: "1.0.0",
					invocationTimestamp: new Date().toISOString(),
					parameters: {},
				},
				phase: "build",
				taskDescription: "Test task",
				status: "completed",
				results: {
					plan: { plan: "# Test Plan" },
					build: {
						steps: [
							{ stepNumber: 1, description: "Create file", status: "completed" },
							{ stepNumber: 2, description: "Update file", status: "failed" },
							{ stepNumber: 3, description: "Delete file", status: "pending" },
						],
					},
				},
				errors: [],
				artifacts: [],
			},
		});

		await handlePlan({}, ["tasks"], { stateFile: "/tmp/test-state.json" });

		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("TASKS"));
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("✓"));
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("○"));
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Summary"));

		consoleLogSpy.mockRestore();
	});

	it("should show message when no tasks exist", async () => {
		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(stateModule, "readStateFile").mockResolvedValue({
			success: true,
			data: {
				metadata: {
					agentName: "tiny-agent",
					agentVersion: "1.0.0",
					invocationTimestamp: new Date().toISOString(),
					parameters: {},
				},
				phase: "plan",
				taskDescription: "Test task",
				status: "completed",
				results: {},
				errors: [],
				artifacts: [],
			},
		});

		await handlePlan({}, ["tasks"], { stateFile: "/tmp/test-state.json" });

		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("No tasks found"));

		consoleLogSpy.mockRestore();
	});

	it("should output tasks as JSON when --json flag is set", async () => {
		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(stateModule, "readStateFile").mockResolvedValue({
			success: true,
			data: {
				metadata: {
					agentName: "tiny-agent",
					agentVersion: "1.0.0",
					invocationTimestamp: new Date().toISOString(),
					parameters: {},
				},
				phase: "build",
				taskDescription: "Test task",
				status: "in_progress",
				results: {
					build: {
						steps: [{ stepNumber: 1, description: "Create file", status: "completed" }],
					},
				},
				errors: [],
				artifacts: [],
			},
		});

		await handlePlan({}, ["tasks"], { stateFile: "/tmp/test-state.json", json: true });

		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('"tasks"'));

		consoleLogSpy.mockRestore();
	});

	it("should show only pending tasks with todo command", async () => {
		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(stateModule, "readStateFile").mockResolvedValue({
			success: true,
			data: {
				metadata: {
					agentName: "tiny-agent",
					agentVersion: "1.0.0",
					invocationTimestamp: new Date().toISOString(),
					parameters: {},
				},
				phase: "build",
				taskDescription: "Test task",
				status: "completed",
				results: {
					build: {
						steps: [
							{ stepNumber: 1, description: "Create file", status: "completed" },
							{ stepNumber: 2, description: "Update file", status: "pending" },
							{ stepNumber: 3, description: "Delete file", status: "pending" },
						],
					},
				},
				errors: [],
				artifacts: [],
			},
		});

		await handlePlan({}, ["todo"], { stateFile: "/tmp/test-state.json" });

		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("TODO"));
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Update file"));
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Delete file"));
		expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining("Create file"));

		consoleLogSpy.mockRestore();
	});

	it("should show message when all tasks are completed", async () => {
		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(stateModule, "readStateFile").mockResolvedValue({
			success: true,
			data: {
				metadata: {
					agentName: "tiny-agent",
					agentVersion: "1.0.0",
					invocationTimestamp: new Date().toISOString(),
					parameters: {},
				},
				phase: "build",
				taskDescription: "Test task",
				status: "completed",
				results: {
					build: {
						steps: [
							{ stepNumber: 1, description: "Create file", status: "completed" },
							{ stepNumber: 2, description: "Update file", status: "completed" },
						],
					},
				},
				errors: [],
				artifacts: [],
			},
		});

		await handlePlan({}, ["todo"], { stateFile: "/tmp/test-state.json" });

		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("No pending tasks"));

		consoleLogSpy.mockRestore();
	});

	it("should output todo as JSON when --json flag is set", async () => {
		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(stateModule, "readStateFile").mockResolvedValue({
			success: true,
			data: {
				metadata: {
					agentName: "tiny-agent",
					agentVersion: "1.0.0",
					invocationTimestamp: new Date().toISOString(),
					parameters: {},
				},
				phase: "build",
				taskDescription: "Test task",
				status: "completed",
				results: {
					build: {
						steps: [{ stepNumber: 1, description: "Create file", status: "pending" }],
					},
				},
				errors: [],
				artifacts: [],
			},
		});

		await handlePlan({}, ["todo"], { stateFile: "/tmp/test-state.json", json: true });

		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('"todos"'));

		consoleLogSpy.mockRestore();
	});

	it("should exit with error for unknown subcommand", async () => {
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("exit");
		});
		vi.spyOn(stateModule, "readStateFile").mockResolvedValue({
			success: true,
			data: {
				metadata: {
					agentName: "tiny-agent",
					agentVersion: "1.0.0",
					invocationTimestamp: new Date().toISOString(),
					parameters: {},
				},
				phase: "plan",
				taskDescription: "Test task",
				status: "pending",
				results: {},
				errors: [],
				artifacts: [],
			},
		});

		await expect(handlePlan({}, ["unknown"], {})).rejects.toThrow("exit");
		expect(processExitSpy).toHaveBeenCalledWith(2);
		expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown plan subcommand"));

		consoleErrorSpy.mockRestore();
		processExitSpy.mockRestore();
	});
});
