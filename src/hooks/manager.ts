/**
 * Hook manager — executes lifecycle hooks by spawning external commands.
 *
 * For each lifecycle event, the manager:
 * 1. Finds all enabled hooks for that event
 * 2. Spawns the hook's command, passing content via stdin (or as an arg)
 * 3. Waits for the command to exit (with optional timeout)
 * 4. Reads stdout as the (possibly modified) content
 * 5. Returns a HookResult with modified content + feedback
 *
 * If a hook's binary is not found, it's skipped (not an error).
 * If a hook fails (non-zero exit), the error is recorded but execution
 * continues to the next hook — the last successful modifiedContent wins.
 *
 * @see src/hooks/types.ts for types
 * @see src/hooks/presets.ts for built-in presets
 */

import { spawn } from "node:child_process";
import { isCommandAvailable } from "../utils/command.js";
import {
	emptyHookRegistry,
	type HookConfig,
	type HookEvent,
	type HookInput,
	type HookRegistry,
	type HookResult,
} from "./types.js";

/** Build a HookRegistry from an array of HookConfig. */
export function buildRegistry(hooks: HookConfig[] | undefined): HookRegistry {
	const registry = emptyHookRegistry();
	if (!hooks) return registry;

	for (const hook of hooks) {
		if (hook.enabled === false) continue;
		const list = registry[hook.event];
		if (list) {
			list.push(hook);
		}
	}

	return registry;
}

/** Check if any hooks are registered for a given event. */
export function hasHooks(registry: HookRegistry, event: HookEvent): boolean {
	const hooks = registry[event];
	return hooks !== undefined && hooks.length > 0;
}

/** Execute a single hook by spawning its command. */
async function executeHook(hook: HookConfig, input: HookInput): Promise<HookResult> {
	// Check if the command binary is available
	const cmdAvailable = await isCommandAvailable(hook.command);
	if (!cmdAvailable) {
		return {
			success: false,
			skipped: true,
			error: `Command not found: ${hook.command}`,
		};
	}

	return new Promise<HookResult>((resolve) => {
		const args = hook.args ?? [];
		const env = { ...process.env, ...hook.env };

		// If inputMode is "arg", append content as the last argument
		const finalArgs = hook.inputMode === "arg" ? [...args, input.content] : args;

		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(hook.command, finalArgs, {
				env,
				stdio: ["pipe", "pipe", "pipe"],
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			resolve({ success: false, error: `Failed to spawn "${hook.command}": ${message}` });
			return;
		}

		let stdout = "";
		let stderr = "";

		child.stdout?.on("data", (data: Buffer) => {
			stdout += data.toString("utf-8");
		});

		child.stderr?.on("data", (data: Buffer) => {
			stderr += data.toString("utf-8");
		});

		// Handle timeout
		let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
		if (hook.timeoutMs && hook.timeoutMs > 0) {
			timeoutHandle = setTimeout(() => {
				child.kill("SIGTERM");
				resolve({
					success: false,
					error: `Hook "${hook.name}" timed out after ${hook.timeoutMs}ms`,
				});
			}, hook.timeoutMs);
		}

		child.on("error", (err) => {
			if (timeoutHandle) clearTimeout(timeoutHandle);
			resolve({
				success: false,
				error: `Hook "${hook.name}" failed to start: ${err.message}`,
			});
		});

		child.on("close", (code) => {
			if (timeoutHandle) clearTimeout(timeoutHandle);

			if (code !== 0) {
				resolve({
					success: false,
					error: `Hook "${hook.name}" exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`,
				});
				return;
			}

			// stdout is the (possibly modified) content
			const modifiedContent = stdout.length > 0 ? stdout : undefined;

			// Check for approval signals in stderr (plannotator convention)
			const stderrTrimmed = stderr.trim();
			const approved = !stderrTrimmed.includes("REJECTED");

			resolve({
				success: true,
				modifiedContent,
				feedback: stderrTrimmed || undefined,
				approved,
			});
		});

		// Pipe content to stdin if inputMode is "stdin"
		if (hook.inputMode !== "arg") {
			child.stdin?.write(input.content);
			child.stdin?.end();
		} else {
			child.stdin?.end();
		}
	});
}

/** Execute all hooks for a given event, passing the content through each in sequence. */
export async function runHooks(registry: HookRegistry, event: HookEvent, input: HookInput): Promise<HookResult> {
	const hooks = registry[event];
	if (!hooks || hooks.length === 0) {
		return { success: true, approved: true };
	}

	let currentContent = input.content;
	let lastFeedback: string | undefined;
	let allApproved = true;
	const errors: string[] = [];
	let anySkipped = false;

	for (const hook of hooks) {
		const hookInput: HookInput = {
			...input,
			content: currentContent,
		};

		const result = await executeHook(hook, hookInput);

		if (result.skipped) {
			anySkipped = true;
			if (hook.command === "plannotator") {
				console.warn(`\n⚠️  Hook "${hook.name}" skipped — plannotator not found.`);
				console.warn("   Install it: npm install -g plannotator");
				console.warn("   Or use: npx plannotator\n");
			}
			continue;
		}

		if (!result.success) {
			errors.push(result.error ?? `Hook "${hook.name}" failed`);
			continue;
		}

		if (result.modifiedContent && hook.applyModifications !== false) {
			currentContent = result.modifiedContent;
		}

		if (result.feedback) {
			lastFeedback = result.feedback;
		}

		if (result.approved === false) {
			allApproved = false;
		}
	}

	return {
		success: errors.length === 0,
		modifiedContent: currentContent !== input.content ? currentContent : undefined,
		feedback: lastFeedback,
		error: errors.length > 0 ? errors.join("; ") : undefined,
		approved: allApproved,
		skipped: anySkipped || undefined,
	};
}
