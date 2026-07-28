/**
 * Review CLI handler — trigger a plan review using configured hooks.
 *
 * Usage:
 *   tiny-agent review              — review the current plan using post-plan-generate hooks
 *   tiny-agent review --event pre-build-execute  — review using pre-build-execute hooks
 *
 * This command loads the plan from the state file and runs it through the
 * configured hooks (e.g. plannotator). If the hook modifies the plan, the
 * updated plan is saved back to the state file.
 */

import { DEFAULT_STATE_FILE, StateManager } from "../../agents/state-manager.js";
import { readConfigFile } from "../../config/config-io.js";
import { getConfigPath } from "../../config/loader.js";
import { buildRegistry, hasHooks, runHooks } from "../../hooks/manager.js";
import { PLANNOTATOR_PRESET } from "../../hooks/presets.js";
import type { HookConfig, HookEvent } from "../../hooks/types.js";
import type { CliOptions } from "../shared.js";

export async function handleReview(_config: unknown, args: string[], options: CliOptions): Promise<void> {
	const stateFile = options.stateFile || DEFAULT_STATE_FILE;
	const eventFlag = args.find((a) => a.startsWith("--event="));
	const event: HookEvent = eventFlag ? (eventFlag.split("=")[1] as HookEvent) : "post-plan-generate";

	// Load hooks from config file
	const configPath = getConfigPath();
	const fileConfig = await readConfigFile(configPath);
	const hooks = (fileConfig.hooks as HookConfig[] | undefined) ?? [];

	// If no hooks configured, offer to install plannotator preset
	if (hooks.length === 0 || !hasHooks(buildRegistry(hooks), event)) {
		console.log(`\n⚠️  No hooks configured for event "${event}".`);
		console.log(`\nTo install the plannotator preset:`);
		console.log(`  tiny-agent hooks install plannotator`);
		console.log(`\nOr configure hooks manually in ${configPath}:`);
		console.log(`  hooks:`);
		console.log(`    - name: plannotator-review`);
		console.log(`      event: ${event}`);
		console.log(`      command: plannotator`);
		console.log(`      args: ["--review"]`);
		console.log(`      inputMode: stdin\n`);
		process.exit(0);
	}

	// Load the plan from the state file
	const mgr = new StateManager(stateFile);
	const state = await mgr.loadOrCreate();
	const plan = mgr.getPlan();
	if (!plan) {
		console.error("\n✗ No plan found in state file.");
		console.error("Run 'tiny-agent plan <task>' to generate a plan first.\n");
		process.exit(1);
	}

	console.log(`\n📋 Reviewing plan (${plan.length} chars) using "${event}" hooks...`);

	const registry = buildRegistry(hooks);
	const hookResult = await runHooks(registry, event, {
		event,
		content: plan,
		stateFile,
		taskDescription: state.taskDescription,
	});

	if (hookResult.skipped) {
		console.log("\n⚠️  Review hook was skipped (binary not found).");
		if (hooks.some((h) => h.command === "plannotator")) {
			console.log(PLANNOTATOR_PRESET.installInstructions ?? "");
		}
		process.exit(0);
	}

	if (!hookResult.success) {
		console.error(`\n✗ Review hook failed: ${hookResult.error}`);
		process.exit(1);
	}

	if (hookResult.feedback) {
		console.log(`\n📋 Feedback:\n${hookResult.feedback}\n`);
	}

	if (hookResult.modifiedContent) {
		// Save the modified plan back to the state file
		mgr.setPlan(hookResult.modifiedContent);
		await mgr.save();
		console.log(`✓ Plan updated (${hookResult.modifiedContent.length} chars) and saved to ${stateFile}`);
	}

	if (hookResult.approved === false) {
		console.log("\n✗ Plan rejected by reviewer.");
		process.exit(1);
	}

	console.log("\n✓ Plan approved by reviewer.");
	process.exit(0);
}
