/**
 * StepExecutor — owns the per-step action execution + error recovery flow
 * extracted from buildAgent().
 *
 * Given a BuildStep + ToolRegistry, this module:
 * 1. Maps each action to a tool call via mapBuildAction (moved here to break
 *    the build-agent.ts ↔ step-executor.ts runtime cycle)
 * 2. Executes via the registry (confirmation handled inside registry)
 * 3. Tracks file changes (create/modify/delete with path)
 * 4. On failure, prompts for retry/skip/abort (via promptChoice or injected fn)
 * 5. Returns a structured StepResult so buildAgent() can write state
 *
 * This makes the step execution path independently testable with a mock
 * ToolRegistry and a mock prompt function — no state file, no plan parsing
 * needed. State-file writes stay in buildAgent() as the orchestration layer.
 */

import { promptChoice } from "../cli/prompt.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { BuildAction, BuildStep } from "./build-agent.js";

/** A tool call shaped for the registry's execute method. */
export interface ToolCall {
	name: string;
	args: Record<string, unknown>;
}

/** Either a mappable tool call or a reason why the action can't be mapped. */
export type MappedBuildAction = { kind: "call"; call: ToolCall } | { kind: "unmappable"; reason: string };

/**
 * Map a build-time intent (BuildAction) into a registry-shaped ToolCall, or
 * report why it can't be mapped. Folding mapping + reason into one exhaustive
 * function keeps every action variant's translation in a single place, so a
 * new BuildAction variant only needs one switch arm — not two (mapping +
 * unmappable-message). Confirmation is handled by the registry, not here;
 * the registry routes dangerous ops through the CLI's confirmation handler
 * with the right danger level (write/edit/delete/bash-destructive).
 */
export function mapBuildAction(action: BuildAction): MappedBuildAction {
	switch (action.type) {
		case "create": {
			if (!action.path) return { kind: "unmappable", reason: "create action requires a path" };
			return {
				kind: "call",
				call: {
					name: "write_file",
					args: { path: action.path, content: action.content ?? "" },
				},
			};
		}
		case "modify": {
			if (!action.path) return { kind: "unmappable", reason: "modify action requires a path" };
			if (action.oldContent && action.content) {
				return {
					kind: "call",
					call: {
						name: "edit_file",
						args: {
							path: action.path,
							old_str: action.oldContent,
							new_str: action.content,
						},
					},
				};
			}
			if (action.content) {
				return {
					kind: "call",
					call: {
						name: "write_file",
						args: { path: action.path, content: action.content },
					},
				};
			}
			return {
				kind: "unmappable",
				reason: "modify action requires both oldContent and content, or just content",
			};
		}
		case "delete": {
			if (!action.path) return { kind: "unmappable", reason: "delete action requires a path" };
			return { kind: "call", call: { name: "delete_file", args: { path: action.path } } };
		}
		case "execute": {
			return { kind: "call", call: { name: "bash", args: { command: action.description } } };
		}
	}
}

/** The result of executing one step's actions. */
export interface StepResult {
	status: "completed" | "failed" | "skipped";
	changes: Array<{
		type: "create" | "modify" | "delete";
		path: string;
		diff?: string;
	}>;
	/** Error message if the step failed (for state-file logging by buildAgent). */
	error?: string;
	/** If true, the user chose to abort — buildAgent should stop immediately. */
	shouldAbort: boolean;
}

type ExecutionOutcome = { success: boolean; output?: string; error?: string };

/** Optional dependency injection for the recovery prompt (testability). */
export interface StepExecutorOptions {
	promptFn?: (question: string, options: string[]) => Promise<string>;
}

export class StepExecutor {
	private _registry: ToolRegistry;
	private _promptFn: (question: string, options: string[]) => Promise<string>;

	constructor(registry: ToolRegistry, options: StepExecutorOptions = {}) {
		this._registry = registry;
		this._promptFn = options.promptFn ?? promptChoice;
	}

	/**
	 * Execute all actions in a step, handling retry/skip/abort on failure.
	 *
	 * Returns a structured StepResult — the caller (buildAgent) is responsible
	 * for writing the state file based on the result.
	 */
	async executeStep(step: BuildStep): Promise<StepResult> {
		const changes: StepResult["changes"] = [];
		let stepSuccess = true;
		let lastError: string | undefined;
		let shouldAbort = false;

		for (const action of step.actions) {
			const result = await this._executeAction(action);

			if (result.success) {
				console.log(`  ✓ ${action.description}`);
				this._trackChange(action, changes);
				continue;
			}

			// Action failed — prompt for recovery
			console.error(`  ✗ ${action.description}: ${result.error}`);
			stepSuccess = false;
			lastError = result.error || "Unknown error";

			const decision = await this._promptRecovery(lastError, step.stepNumber);

			if (decision === "abort") {
				shouldAbort = true;
				break;
			}

			if (decision === "skip") {
				console.log(`  Skipping step ${step.stepNumber}`);
				return {
					status: "skipped",
					changes,
					error: lastError,
					shouldAbort: false,
				};
			}

			// retry — attempt the same action once more
			if (decision === "retry") {
				console.log(`  Retrying step ${step.stepNumber}...`);
				const retryResult = await this._executeAction(action);
				if (retryResult.success) {
					console.log(`  ✓ ${action.description} (retry successful)`);
					this._trackChange(action, changes);
					stepSuccess = true;
				} else {
					stepSuccess = false;
				}
			}
		}

		return {
			status: stepSuccess ? "completed" : "failed",
			changes: changes.length > 0 ? changes : [],
			error: stepSuccess ? undefined : lastError,
			shouldAbort,
		};
	}

	/** Execute a single action via the registry, mapping it to a tool call first. */
	private async _executeAction(action: BuildAction): Promise<ExecutionOutcome> {
		const mapped = mapBuildAction(action);
		if (mapped.kind === "unmappable") {
			return { success: false, error: mapped.reason };
		}
		return this._registry.execute(mapped.call.name, mapped.call.args);
	}

	/** Track a file change if the action has a path and is a file operation. */
	private _trackChange(action: BuildAction, changes: StepResult["changes"]): void {
		const actionPath = action.path;
		if (actionPath && (action.type === "create" || action.type === "modify" || action.type === "delete")) {
			changes.push({
				type: action.type,
				path: actionPath,
			});
		}
	}

	/** Prompt the user for a retry/skip/abort decision after a failed action. */
	private async _promptRecovery(error: string, stepNumber: number): Promise<"retry" | "skip" | "abort"> {
		console.error(`\n❌ Error in step ${stepNumber}: ${error}`);
		const decision = await this._promptFn("\nWhat would you like to do?", ["retry", "skip", "abort"]);
		return decision.toLowerCase() as "retry" | "skip" | "abort";
	}
}
