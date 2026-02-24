import { readStateFile } from "../../agents/state.js";
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
	const phases: PlanPhase[] = [];
	const lines = planText.split("\n");

	let currentPhase: PlanPhase | null = null;

	for (const line of lines) {
		const phaseMatch = line.match(/^##\s+(?:Phase\s+\d+[:.]\s*)?(.+)/i);
		if (phaseMatch) {
			if (currentPhase) {
				phases.push(currentPhase);
			}
			currentPhase = { name: phaseMatch[1]?.trim() ?? "", tasks: [] };
			continue;
		}

		if (currentPhase) {
			const taskMatch = line.match(/^[-*]\s+\[[ x]\]\s*(.+)/i) || line.match(/^[-*]\s+(.+)/);
			if (taskMatch?.[1] && !taskMatch[1].startsWith("**")) {
				currentPhase.tasks.push(taskMatch[1].trim());
			}
		}
	}

	if (currentPhase) {
		phases.push(currentPhase);
	}

	return phases;
}

export async function handlePlan(_config: unknown, args: string[], options: CliOptions): Promise<void> {
	const stateFile = options.stateFile || DEFAULT_STATE_FILE;
	const subcommand = args[0];

	if (!subcommand) {
		console.error("Error: plan command requires a subcommand (show, tasks, todo)");
		console.error("");
		console.error("  show   - Display the full plan");
		console.error("  tasks  - Show build step progress (after running build)");
		console.error("  todo   - Show pending build steps");
		process.exit(2);
	}

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

	const state = stateResult.data;

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
			if (state.results?.plan?.plan) {
				const phases = extractPhasesFromPlan(state.results.plan.plan);
				const allTasks = phases.flatMap((p) => p.tasks);

				if (allTasks.length > 0) {
					if (options.json) {
						console.log(JSON.stringify({ todos: allTasks, source: "plan" }, null, 2));
					} else {
						console.log("=".repeat(60));
						console.log("📝 TODO (from plan - not yet executed)");
						console.log("=".repeat(60));
						console.log();

						let taskNum = 1;
						for (const phase of phases) {
							if (phase.tasks.length > 0) {
								console.log(`📁 ${phase.name}`);
								for (const task of phase.tasks) {
									console.log(`   ${taskNum}. ${task}`);
									taskNum++;
								}
								console.log();
							}
						}

						console.log("─".repeat(60));
						console.log(`Total: ${allTasks.length} task${allTasks.length === 1 ? "" : "s"} to do`);
						console.log("Run 'tiny-agent build' to start executing.");
					}
					return;
				}
			}

			if (options.json) {
				console.log(JSON.stringify({ todos: [], message: "No pending tasks" }, null, 2));
			} else {
				console.log("✓ No pending tasks. All tasks are completed!");
			}
			return;
		}

		if (options.json) {
			console.log(JSON.stringify({ todos: pendingTasks, source: "build" }, null, 2));
		} else {
			console.log("=".repeat(60));
			console.log("📝 TODO (pending build steps)");
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
