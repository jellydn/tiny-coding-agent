import { parse as parsePlanGrammar } from "../../agents/plan-grammar.js";
import { readStateFile } from "../../agents/state.js";
import { StateManager } from "../../agents/state-manager.js";
import type { CliOptions } from "../shared.js";

const DEFAULT_STATE_FILE = ".tiny-state.json";

interface TaskStatus {
	stepNumber: number;
	description: string;
	status: "pending" | "completed" | "failed" | "skipped";
}

interface PlanPhase {
	name: string;
	tasks: string[];
}

function extractPhasesFromPlan(planText: string): PlanPhase[] {
	const plan = parsePlanGrammar(planText);
	return plan.phases.map((phase) => ({
		name: phase.title,
		tasks: phase.successCriteria,
	}));
}

export async function handlePlan(_config: unknown, args: string[], options: CliOptions): Promise<void> {
	const stateFile = options.stateFile || DEFAULT_STATE_FILE;
	const subcommand = args[0];

	if (!subcommand) {
		console.error("Error: plan command requires a subcommand (show, tasks, todo)");
		console.error("");
		console.error("  show   - Display the full plan");
		console.error("  tasks  - List all tasks with status");
		console.error("  todo   - Show current active task");
		process.exit(2);
	}

	// Check if the state file actually exists on disk — StateManager's
	// loadOrCreate() creates a fresh state if the file is missing, which
	// would mask the "not found" error for the user.
	const stateResult = await readStateFile(stateFile, { ignoreMissing: true });
	if (!stateResult.success) {
		console.error(`Error reading state file: ${stateResult.error}`);
		process.exit(1);
	}
	if (!stateResult.data) {
		console.error(`No state file found at: ${stateFile}`);
		console.error("Run 'tiny-agent plan <task>' to generate a plan first.");
		process.exit(1);
	}

	const mgr = new StateManager(stateFile);
	const state = await mgr.loadOrCreate();

	if (subcommand === "show") {
		if (state.results?.plan?.plan) {
			if (options.json) {
				console.log(JSON.stringify({ plan: state.results.plan.plan }, null, 2));
			} else {
				console.log("=".repeat(60));
				console.log("📋 PLAN");
				console.log("=".repeat(60));
				console.log();
				console.log(state.results.plan.plan);
			}
		} else {
			if (options.json) {
				console.log(JSON.stringify({ plan: null, message: "No plan found in state file" }, null, 2));
			} else {
				console.log("No plan found in state file.");
				console.log("Run 'tiny-agent plan <task>' to generate a plan first.");
			}
		}
	} else if (subcommand === "tasks") {
		const tasks: TaskStatus[] = [];

		if (state.results?.build?.steps) {
			for (const step of state.results.build.steps) {
				tasks.push({
					stepNumber: step.stepNumber,
					description: step.description,
					status: step.status,
				});
			}
		}

		if (tasks.length === 0) {
			if (state.results?.plan?.plan) {
				const phases = extractPhasesFromPlan(state.results.plan.plan);
				if (phases.length > 0) {
					if (options.json) {
						console.log(JSON.stringify({ phases, source: "plan" }, null, 2));
					} else {
						console.log("=".repeat(60));
						console.log("📋 PLAN PHASES (not yet executed)");
						console.log("=".repeat(60));
						console.log();

						for (const phase of phases) {
							console.log(`📁 ${phase.name}`);
							for (const task of phase.tasks) {
								console.log(`   ○ ${task}`);
							}
							console.log();
						}

						console.log("─".repeat(60));
						console.log("Run 'tiny-agent build' to execute these tasks.");
					}
					return;
				}
			}

			if (options.json) {
				console.log(JSON.stringify({ tasks: [], message: "No tasks found" }, null, 2));
			} else {
				console.log("No tasks found in state file.");
				console.log("Run 'tiny-agent plan <task>' to generate a plan first.");
			}
			return;
		}

		if (options.json) {
			console.log(JSON.stringify({ tasks, source: "build" }, null, 2));
		} else {
			console.log("=".repeat(60));
			console.log("🔧 BUILD TASKS");
			console.log("=".repeat(60));
			console.log();

			for (const task of tasks) {
				const statusIcon = getStatusIcon(task.status);
				const statusText = getStatusText(task.status);
				console.log(`  ${statusIcon} [${task.stepNumber}] ${task.description}`);
				console.log(`      Status: ${statusText}`);
				console.log();
			}

			const completed = tasks.filter((t) => t.status === "completed").length;
			const pending = tasks.filter((t) => t.status === "pending").length;
			const failed = tasks.filter((t) => t.status === "failed").length;
			const skipped = tasks.filter((t) => t.status === "skipped").length;

			console.log("=".repeat(60));
			console.log(
				`Summary: ${completed}/${tasks.length} completed, ${pending} pending, ${failed} failed, ${skipped} skipped`
			);
		}
	} else if (subcommand === "todo") {
		const currentTask = state.currentTask;

		if (!currentTask) {
			if (options.json) {
				console.log(JSON.stringify({ currentTask: null, message: "No active task" }, null, 2));
			} else {
				console.log("No active task.");
				console.log("");
				if (state.status === "completed") {
					console.log("✓ All tasks completed!");
				} else if (state.status === "pending") {
					console.log("Run 'tiny-agent build' to start executing tasks.");
				} else if (state.status === "failed") {
					console.log("Last execution failed. Check 'tiny-agent tasks' for details.");
				}
			}
			return;
		}

		if (options.json) {
			console.log(JSON.stringify({ currentTask }, null, 2));
		} else {
			console.log("=".repeat(60));
			console.log("🎯 CURRENT TASK");
			console.log("=".repeat(60));
			console.log();
			console.log(`  Step:    ${currentTask.stepNumber}`);
			console.log(`  Task:    ${currentTask.description}`);
			console.log(`  Phase:   ${currentTask.phase}`);
			console.log(`  Started: ${currentTask.startedAt}`);
			console.log();
		}
	} else {
		console.error(`Unknown plan subcommand: ${subcommand}`);
		console.error("Available subcommands: show, tasks, todo");
		process.exit(2);
	}
}

function getStatusIcon(status: string): string {
	switch (status) {
		case "completed":
			return "✓";
		case "failed":
			return "✗";
		case "skipped":
			return "⊘";
		default:
			return "○";
	}
}

function getStatusText(status: string): string {
	switch (status) {
		case "completed":
			return "Done";
		case "failed":
			return "Failed";
		case "skipped":
			return "Skipped";
		default:
			return "Pending";
	}
}
