import { readStateFile } from "../../agents/state.js";
import type { CliOptions } from "../shared.js";

const DEFAULT_STATE_FILE = ".tiny-state.json";

interface TaskStatus {
	stepNumber: number;
	description: string;
	status: "pending" | "completed" | "failed" | "skipped";
}

export async function handlePlan(_config: unknown, args: string[], options: CliOptions): Promise<void> {
	const stateFile = options.stateFile || DEFAULT_STATE_FILE;
	const subcommand = args[0];

	if (!subcommand) {
		console.error("Error: plan command requires a subcommand (show, tasks, todo)");
		process.exit(2);
	}

	const stateResult = await readStateFile(stateFile, { ignoreMissing: true });

	if (!stateResult.success) {
		console.error(`Error reading state file: ${stateResult.error}`);
		process.exit(1);
	}

	if (!stateResult.data) {
		console.error(`No state file found at: ${stateFile}`);
		process.exit(1);
	}

	const state = stateResult.data;

	if (subcommand === "show") {
		if (state.results?.plan?.plan) {
			if (options.json) {
				console.log(JSON.stringify({ plan: state.results.plan.plan }, null, 2));
			} else {
				console.log("=".repeat(60));
				console.log("PLAN");
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
			if (options.json) {
				console.log(JSON.stringify({ tasks: [], message: "No tasks found in state file" }, null, 2));
			} else {
				console.log("No tasks found in state file.");
				console.log("Run 'tiny-agent run-plan-build <task>' to generate tasks first.");
			}
			return;
		}

		if (options.json) {
			console.log(JSON.stringify({ tasks }, null, 2));
		} else {
			console.log("=".repeat(60));
			console.log("TASKS");
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
		const pendingTasks: TaskStatus[] = [];

		if (state.results?.build?.steps) {
			for (const step of state.results.build.steps) {
				if (step.status === "pending") {
					pendingTasks.push({
						stepNumber: step.stepNumber,
						description: step.description,
						status: step.status,
					});
				}
			}
		}

		if (pendingTasks.length === 0) {
			if (options.json) {
				console.log(JSON.stringify({ todos: [], message: "No pending tasks" }, null, 2));
			} else {
				console.log("No pending tasks. All tasks are completed!");
			}
			return;
		}

		if (options.json) {
			console.log(JSON.stringify({ todos: pendingTasks }, null, 2));
		} else {
			console.log("=".repeat(60));
			console.log("TODO");
			console.log("=".repeat(60));
			console.log();

			for (const task of pendingTasks) {
				console.log(`  ○ [${task.stepNumber}] ${task.description}`);
			}

			console.log();
			console.log(`Total: ${pendingTasks.length} pending task${pendingTasks.length === 1 ? "" : "s"}`);
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
