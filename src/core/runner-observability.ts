/**
 * RunnerObservability — thin wrapper around AgentObservability for use
 * inside Agent.runStream(). Collapses the scattered `// --- Observability:`
 * comment blocks into focused, single-purpose methods so runStream() reads
 * as business logic without interleaved span/timer management.
 *
 * Each method wraps the corresponding AgentObservability calls required
 * for a lifecycle phase (begin LLLM call, record tool execution, etc.)
 * into one call, returning the data the caller needs to continue.
 */

import type { SpanHandle, Timer } from "../observability/index.js";
import type { AgentObservability, AgentObservabilityMeta, LlmCallResult, ToolLogEntry } from "./agent-observability.js";

export class RunnerObservability {
	private _obs: AgentObservability;
	private _provider: string;
	private _model: string;

	constructor(obs: AgentObservability, provider: string, model: string) {
		this._obs = obs;
		this._provider = provider;
		this._model = model;
	}

	/** The provider name for the current request. */
	get provider(): string {
		return this._provider;
	}

	/** The model name for the current request. */
	get model(): string {
		return this._model;
	}

	/** Begin a request: establish trace context, root span, timer, and log start. */
	begin(userPrompt: string): void {
		this._obs.beginRequest(userPrompt, { provider: this._provider, model: this._model });
	}

	/**
	 * Start an LLM call span + timer, returning the handles.
	 * Caller records LLM response via {@link recordLlmCall} or
	 * error via {@link recordLlmCallError}.
	 */
	beginLlmCall(): { span: SpanHandle; timer: Timer } {
		return this._obs.beginLlmCall({ provider: this._provider, model: this._model });
	}

	/** Record a successful LLM response (ends span, accumulates usage, logs). */
	recordLlmCall(span: SpanHandle, timer: Timer, result: LlmCallResult, userPrompt: string): void {
		this._obs.recordLlmResponse(span, timer, { provider: this._provider, model: this._model }, result, userPrompt);
	}

	/** Record an LLM call error. */
	recordLlmCallError(span: SpanHandle, err: unknown): void {
		this._obs.recordLlmCallError(span, err);
	}

	/** Start a tool execution span + timer. */
	beginToolExecution(): { span: SpanHandle; timer: Timer } {
		return this._obs.beginToolExecution();
	}

	/** Record tool execution results. */
	recordToolExecution(span: SpanHandle, timer: Timer, toolNames: string[], entries: ToolLogEntry[]): void {
		this._obs.recordToolResult(span, timer, toolNames, entries);
	}

	/** Record a request-level error (used in catch block). */
	requestError(err: unknown): void {
		this._obs.recordRequestError({ provider: this._provider, model: this._model }, err);
	}

	/** Finalize the request: close root span and emit request.end log. */
	finalize(): void {
		this._obs.finalize({ provider: this._provider, model: this._model });
	}

	/** Build observability metadata for the final response chunk. */
	buildMeta(): AgentObservabilityMeta {
		return this._obs.buildMeta(this._model);
	}

	/** Mark the request as failed. */
	markFailed(): void {
		this._obs.markFailed();
	}
}
