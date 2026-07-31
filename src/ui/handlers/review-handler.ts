/**
 * review-handler.ts — /review command handler for tiny-agent chat UI.
 *
 * Extracted from useCommandHandler.ts (Round 8 Candidate #2) so review
 * logic is independently testable.
 */

import { DEFAULT_STATE_FILE, StateManager } from "../../agents/state-manager.js";
import { readConfigFile } from "../../config/config-io.js";
import { getConfigPath } from "../../config/loader.js";
import { buildRegistry, hasHooks, runHooks } from "../../hooks/manager.js";
import { PLANNOTATOR_PRESET } from "../../hooks/presets.js";
import type { HookConfig } from "../../hooks/types.js";
import { MessageRole } from "../types/enums.js";

interface ReviewHandlerDeps {
	onAddMessage: (role: MessageRole, content: string) => void;
}

/**
 * Handle the /review command — run review hooks on the current plan.
 */
export async function handleReviewCommand(deps: ReviewHandlerDeps): Promise<void> {
	const { onAddMessage } = deps;
	const stateFile = DEFAULT_STATE_FILE;

	// Load hooks from config file
	let hooks: HookConfig[] = [];
	try {
		const configPath = getConfigPath();
		const fileConfig = await readConfigFile(configPath);
		hooks = (fileConfig.hooks as HookConfig[] | undefined) ?? [];
	} catch {
		onAddMessage(MessageRole.ASSISTANT, "Error: Could not read config file for hooks.");
		return;
	}

	if (hooks.length === 0 || !hasHooks(buildRegistry(hooks), "post-plan-generate")) {
		onAddMessage(
			MessageRole.ASSISTANT,
			"No review hooks configured.\n\n" +
				"To install the plannotator preset, exit and run:\n" +
				"  tiny-agent hooks install plannotator\n\n" +
				"Or add hooks manually in config.yaml."
		);
		return;
	}

	// Load the plan from the state file
	const mgr = new StateManager(stateFile);
	const state = await mgr.loadOrCreate();
	const plan = mgr.getPlan();
	if (!plan) {
		onAddMessage(MessageRole.ASSISTANT, "No plan found in state file. Run 'tiny-agent plan <task>' first.");
		return;
	}

	onAddMessage(MessageRole.ASSISTANT, `📋 Reviewing plan (${plan.length} chars) with configured hooks...`);

	const registry = buildRegistry(hooks);
	const hookResult = await runHooks(registry, "post-plan-generate", {
		event: "post-plan-generate",
		content: plan,
		stateFile,
		taskDescription: state.taskDescription,
	});

	if (hookResult.skipped) {
		onAddMessage(
			MessageRole.ASSISTANT,
			`⚠️ Review hook was skipped (binary not found).\n\n${PLANNOTATOR_PRESET.installInstructions ?? ""}`
		);
		return;
	}

	if (!hookResult.success) {
		onAddMessage(MessageRole.ASSISTANT, `✗ Review hook failed: ${hookResult.error ?? "unknown error"}`);
		return;
	}

	if (hookResult.feedback) {
		onAddMessage(MessageRole.ASSISTANT, `📋 Feedback:\n${hookResult.feedback}`);
	}

	if (hookResult.modifiedContent) {
		mgr.setPlan(hookResult.modifiedContent);
		try {
			await mgr.save();
		} catch {
			/* state write errors are non-fatal */
		}
		onAddMessage(
			MessageRole.ASSISTANT,
			`✓ Plan updated (${hookResult.modifiedContent.length} chars) and saved to ${stateFile}`
		);
	}

	if (hookResult.approved === false) {
		onAddMessage(MessageRole.ASSISTANT, "✗ Plan rejected by reviewer.");
		return;
	}

	onAddMessage(MessageRole.ASSISTANT, "✓ Plan approved by reviewer.");
}
