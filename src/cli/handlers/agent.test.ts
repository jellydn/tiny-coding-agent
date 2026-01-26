import { beforeEach, describe, expect, it, vi } from "bun:test";
import * as buildModule from "../../agents/build-agent.js";
import * as exploreModule from "../../agents/explore-agent.js";
import * as agentModule from "../../agents/plan-agent.js";
import * as stateModule from "../../agents/state.js";
import { handleAgent } from "./agent.js";

describe("handleAgent", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("should exit with error when plan command has no task description", async () => {
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("exit");
		});

		await expect(handleAgent("plan", [], {})).rejects.toThrow("exit");
		expect(processExitSpy).toHaveBeenCalledWith(2);
		expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("requires a task description"));

		consoleErrorSpy.mockRestore();
		processExitSpy.mockRestore();
	});

	it("should exit with error when run-plan-build command has no task description", async () => {
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("exit");
		});

		await expect(handleAgent("run-plan-build", [], {})).rejects.toThrow("exit");
		expect(processExitSpy).toHaveBeenCalledWith(2);
		expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("requires a task description"));

		consoleErrorSpy.mockRestore();
		processExitSpy.mockRestore();
	});

	it("should exit with error when run-all command has no task description", async () => {
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("exit");
		});

		await expect(handleAgent("run-all", [], {})).rejects.toThrow("exit");
		expect(processExitSpy).toHaveBeenCalledWith(2);
		expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("requires a task description"));

		consoleErrorSpy.mockRestore();
		processExitSpy.mockRestore();
	});

	it("should handle plan command with task description", async () => {
		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(agentModule, "planAgent").mockResolvedValue({
			success: true,
			plan: "# Test Plan\n\nTest content",
		});

		await handleAgent("plan", ["Create a new API"], { stateFile: "/tmp/test-state.json" });

		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Plan command received"));
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Create a new API"));
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("State file"));
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Generated Plan"));

		consoleLogSpy.mockRestore();
	});

	it("should handle build command with existing state file", async () => {
		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
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
		vi.spyOn(buildModule, "buildAgent").mockResolvedValue({
			success: true,
			steps: [],
		});

		await handleAgent("build", [], { stateFile: "/tmp/test-state.json" });

		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Build command received"));
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("State file"));
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Build completed successfully"));

		consoleLogSpy.mockRestore();
		consoleErrorSpy.mockRestore();
	});

	it("should exit with error when build command has no state file", async () => {
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("exit");
		});
		vi.spyOn(stateModule, "readStateFile").mockResolvedValue({
			success: false,
			error: "State file not found: /tmp/test-state.json",
		});

		await expect(handleAgent("build", [], { stateFile: "/tmp/test-state.json" })).rejects.toThrow("exit");
		expect(processExitSpy).toHaveBeenCalledWith(1);
		expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Could not read state file"));

		consoleErrorSpy.mockRestore();
		processExitSpy.mockRestore();
	});

	it("should exit with error when build command has no plan", async () => {
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
				status: "completed",
				results: {},
				errors: [],
				artifacts: [],
			},
		});

		await expect(handleAgent("build", [], { stateFile: "/tmp/test-state.json" })).rejects.toThrow("exit");
		expect(processExitSpy).toHaveBeenCalledWith(1);
		expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("No plan found"));

		consoleErrorSpy.mockRestore();
		processExitSpy.mockRestore();
	});

	it("should handle explore command with task", async () => {
		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(exploreModule, "exploreAgent").mockResolvedValue({
			success: true,
			findings: "# Analysis Report\n\n## Key Findings\n- Test finding",
			recommendations: "- Test recommendation",
			metrics: { fileCount: 100 },
		});
		await handleAgent("explore", ["Analyze the auth module"], { stateFile: "/tmp/test-state.json" });

		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Explore command received"));
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Analyze the auth module"));
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Exploration Findings"));
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Exploration results written to state file"));

		consoleLogSpy.mockRestore();
	});

	it("should handle explore command without task (uses default)", async () => {
		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(exploreModule, "exploreAgent").mockResolvedValue({
			success: true,
			findings: "# Analysis Report",
			metrics: {},
		});
		await handleAgent("explore", [], { stateFile: "/tmp/test-state.json" });

		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Explore command received"));
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Explore codebase structure"));

		consoleLogSpy.mockRestore();
	});

	it("should handle run-plan-build command", async () => {
		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(agentModule, "planAgent").mockResolvedValue({
			success: true,
			plan: "# Test Plan\n\n## Phase 1: Test\n1. Test step",
		});
		vi.spyOn(buildModule, "buildAgent").mockResolvedValue({
			success: true,
			steps: [],
		});

		await handleAgent("run-plan-build", ["Add user authentication"], { stateFile: "/tmp/test-state.json" });

		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Run plan-build command received"));
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Add user authentication"));
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Phase 1/2"));
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Phase 2/2"));
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("run-plan-build completed"));

		consoleLogSpy.mockRestore();
	});

	it("should handle run-all command", async () => {
		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(agentModule, "planAgent").mockResolvedValue({
			success: true,
			plan: "# Test Plan\n\n## Phase 1: Test\n1. Test step",
		});
		vi.spyOn(buildModule, "buildAgent").mockResolvedValue({
			success: true,
			steps: [],
		});
		vi.spyOn(exploreModule, "exploreAgent").mockResolvedValue({
			success: true,
			findings: "# Analysis Report",
			metrics: {},
		});
		await handleAgent("run-all", ["Create a new feature"], { stateFile: "/tmp/test-state.json" });

		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Run all command received"));
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Create a new feature"));
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Phase 1/3"));
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Phase 2/3"));
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Phase 3/3"));
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("run-all completed"));

		consoleLogSpy.mockRestore();
	});

	it("should show verbose options when verbose flag is set", async () => {
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
		vi.spyOn(buildModule, "buildAgent").mockResolvedValue({
			success: true,
			steps: [],
		});

		await handleAgent("build", [], { stateFile: "/tmp/test-state.json", verbose: true });

		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Options:"));
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("stateFile"));
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("verbose"));

		consoleLogSpy.mockRestore();
	});

	it("should exit with error for unknown agent command", async () => {
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("exit");
		});

		await expect(handleAgent("unknown", [], {})).rejects.toThrow("exit");
		expect(processExitSpy).toHaveBeenCalledWith(2);
		expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown agent command"));

		consoleErrorSpy.mockRestore();
		processExitSpy.mockRestore();
	});
});
