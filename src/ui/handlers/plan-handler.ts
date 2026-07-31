/**
 * plan-handler.ts — /plan command handler for tiny-agent chat UI.
 *
 * Extracted from useCommandHandler.ts (Round 8 Candidate #2) so plan
 * display logic is independently testable.
 */

import { DEFAULT_STATE_FILE, StateManager } from "../../agents/state-manager.js";
import { MessageRole } from "../types/enums.js";

interface PlanHandlerDeps {
	onAddMessage: (role: MessageRole, content: string) => void;
}

/**
 * Handle the /plan command — show plan, tasks, or todo list.
 */
export async function handlePlanCommand(
	args: string,
	deps: PlanHandlerDeps
): Promise<void> {
	const { onAddMessage } = deps;
	const subcommand = args.trim().toLowerCase() || "show";
	const stateFile = DEFAULT_STATE_FILE;

	const mgr = new StateManager(stateFile);
	const loadResult = await mgr.loadOrFail();
	if (!loadResult.success) {
		onAddMessage(MessageRole.ASSISTANT, "No state file found. Run 'tiny-agent plan <task>' first.");
		return;
	}

	if (subcommand === "show") {
		const plan = mgr.getPlan();
		if (plan) {
			onAddMessage(MessageRole.ASSISTANT, `**Current Plan**\n\n${plan}`);
		} else {
			onAddMessage(
				MessageRole.ASSISTANT,
				"No plan found in state file.\n\nRun 'tiny-agent plan <task>' to generate a plan first."
			);
		}
	} else if (subcommand === "tasks") {
		const steps = mgr.getBuildSteps();

		if (!steps || steps.length === 0) {
			onAddMessage(
				MessageRole.ASSISTANT,
				"No tasks found in state file.\n\nRun 'tiny-agent run-plan-build <task>' to generate tasks first."
			);
			return;
		}

		const taskList = steps
			.map((step) => {
				const icon = step.status === "completed" ? "✓" : step.status === "failed" ? "✗" : "○";
				return `  ${icon} **[${step.stepNumber}]** ${step.description}`;
			})
			.join("\n");

		const completed = steps.filter((s) => s.status === "completed").length;
		const pending = steps.filter((s) => s.status === "pending").length;
		const failed = steps.filter((s) => s.status === "failed").length;

		onAddMessage(
			MessageRole.ASSISTANT,
			`**Tasks** (${completed}/${steps.length} completed, ${pending} pending, ${failed} failed)\n\n${taskList}`
		);
	} else if (subcommand === "todo") {
		const steps = mgr.getBuildSteps();
		const pendingSteps = steps?.filter((s) => s.status === "pending") ?? [];

		if (pendingSteps.length === 0) {
			onAddMessage(MessageRole.ASSISTANT, "No pending tasks. All tasks are completed!");
			return;
		}

		const todoList = pendingSteps.map((step) => `  ○ **[${step.stepNumber}]** ${step.description}`).join("\n");

		onAddMessage(MessageRole.ASSISTANT, `**TODO** (${pendingSteps.length} pending)\n\n${todoList}`);
	} else {
		onAddMessage(
			MessageRole.ASSISTANT,
			`Unknown plan subcommand: ${subcommand}\n\nAvailable: /plan show, /tasks, /todo`
		);
	}
}
