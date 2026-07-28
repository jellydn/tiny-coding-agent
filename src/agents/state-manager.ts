/**
 * StateManager — deep module for agent state file lifecycle.
 *
 * Consolidates the readStateFile → merge results → writeStateFile pattern
 * that was duplicated across 7 modules (plan-agent, explore-agent,
 * build-agent, handlers/plan, handlers/review, handlers/agent,
 * useCommandHandler) with 19 total I/O calls.
 *
 * The interface is the test surface: loadOrCreate() → updatePhase() /
 * mergeResult() / addError() → save(). No caller needs to construct
 * StateFile boilerplate or know about the file-locking internals.
 *
 * For read-only CLI commands that need to fail when the state file is
 * missing (instead of creating a fresh one), use loadOrFail() — it
 * returns a discriminated union so callers can map errors to their own
 * user-facing messages without a double-read.
 */

import { readStateFile, type StateResult, writeStateFile } from "./state.js";

// Re-export for backward compatibility — CLI handlers and agents import
// DEFAULT_STATE_FILE from state-manager.js (the module they already depend on).
export { DEFAULT_STATE_FILE } from "./state.js";

import type { AgentPhase, AgentResult, AgentStatus, BuildResult, StateError, StateFile } from "./types.js";

const DEFAULT_AGENT_NAME = "tiny-agent";
const DEFAULT_AGENT_VERSION = "1.0.0";

export interface StateManagerOptions {
	/** Override agent name in auto-created metadata (default: "tiny-agent"). */
	agentName?: string;
	/** Override agent version in auto-created metadata (default: "1.0.0"). */
	agentVersion?: string;
	/** Extra parameters to include in auto-created metadata. */
	parameters?: Record<string, unknown>;
}

/** Result of {@link StateManager.loadOrFail} — discriminates read errors from "not found". */
export type LoadOrFailResult =
	| { success: true; state: StateFile }
	| { success: false; error: string; code: "read_error" | "not_found" };

export class StateManager {
	private _filePath: string;
	private _state: StateFile | undefined;
	private _options: StateManagerOptions;

	constructor(filePath: string, options?: StateManagerOptions) {
		this._filePath = filePath;
		this._options = options ?? {};
	}

	/**
	 * Load the state file, or create a fresh one if it doesn't exist.
	 * Caches the result so subsequent calls are idempotent within a single
	 * StateManager instance.
	 */
	async loadOrCreate(taskDescription = ""): Promise<StateFile> {
		if (this._state) {
			return this._state;
		}

		const result = await readStateFile(this._filePath, { ignoreMissing: true });
		if (result.success && result.data) {
			this._state = result.data;
			return this._state;
		}

		// Create a fresh state file
		this._state = {
			metadata: {
				agentName: this._options.agentName ?? DEFAULT_AGENT_NAME,
				agentVersion: this._options.agentVersion ?? DEFAULT_AGENT_VERSION,
				invocationTimestamp: new Date().toISOString(),
				parameters: this._options.parameters ?? {},
			},
			phase: "plan",
			taskDescription,
			status: "pending",
			results: {},
			errors: [],
			artifacts: [],
		};
		return this._state;
	}

	/** Get the current cached state (without reading from disk). */
	get state(): StateFile {
		if (!this._state) {
			throw new Error("State not loaded — call loadOrCreate() first");
		}
		return this._state;
	}

	/** Update the phase and status on the state. */
	updatePhase(phase: AgentPhase, status: AgentStatus): void {
		this.state.phase = phase;
		this.state.status = status;
	}

	/** Set the current task being worked on. */
	setCurrentTask(task: { stepNumber: number; description: string; phase: AgentPhase }): void {
		this.state.currentTask = {
			...task,
			startedAt: new Date().toISOString(),
		};
	}

	/** Clear the current task (e.g. after completion). */
	clearCurrentTask(): void {
		this.state.currentTask = undefined;
	}

	/**
	 * Merge a result key (e.g. "plan", "build", "exploration") into the
	 * state's results object, preserving other existing results.
	 */
	mergeResult(key: keyof AgentResult, value: AgentResult[keyof AgentResult]): void {
		this.state.results = {
			...this.state.results,
			[key]: value,
		};
	}

	/** Append an error to the state's errors array. */
	addError(phase: AgentPhase, message: string, details?: Record<string, unknown>): void {
		const error: StateError = {
			timestamp: new Date().toISOString(),
			phase,
			message,
			details,
		};
		this.state.errors = [...this.state.errors, error];
	}

	/** Save the current state to disk. */
	async save(): Promise<StateResult<void>> {
		return writeStateFile(this._filePath, this.state);
	}

	/**
	 * Convenience: save and return whether the write succeeded.
	 * Throws on failure for callers that want the error to propagate.
	 */
	async saveOrThrow(): Promise<void> {
		const result = await this.save();
		if (!result.success) {
			throw new Error(`Failed to write state file: ${result.error}`);
		}
	}

	/**
	 * Save with an error recorded. Combines addError + updatePhase(failed) +
	 * save in a single call — the most common error-recovery pattern.
	 */
	async saveWithError(phase: AgentPhase, message: string, details?: Record<string, unknown>): Promise<void> {
		this.updatePhase(phase, "failed");
		this.addError(phase, message, details);
		await this.save();
	}

	/**
	 * Load the state file, or return an error result if it doesn't exist
	 * or can't be read. Unlike {@link loadOrCreate}, this never creates a
	 * fresh state — it's for read-only CLI commands that need to surface
	 * "not found" errors to the user.
	 *
	 * Caches the result so subsequent calls are idempotent within a single
	 * StateManager instance.
	 */
	async loadOrFail(): Promise<LoadOrFailResult> {
		if (this._state) {
			return { success: true, state: this._state };
		}

		const result = await readStateFile(this._filePath, { ignoreMissing: true });
		if (!result.success) {
			return { success: false, error: result.error ?? "Unknown read error", code: "read_error" };
		}
		if (!result.data) {
			return { success: false, error: `No state file found at: ${this._filePath}`, code: "not_found" };
		}

		this._state = result.data;
		return { success: true, state: this._state };
	}

	/** Get the plan text from the state, if present. */
	getPlan(): string | undefined {
		return this.state.results?.plan?.plan;
	}

	/** Get the build steps from the state, if present. */
	getBuildSteps(): BuildResult["steps"] | undefined {
		return this.state.results?.build?.steps;
	}

	/** Update the plan in the state results. */
	setPlan(plan: string): void {
		this.mergeResult("plan", { plan });
	}
}
