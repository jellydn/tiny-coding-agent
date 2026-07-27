/**
 * AgentObservability — owns all observability instrumentation for the agent
 * loop (spans, timers, logs, cost estimation, Langfuse).
 *
 * Extracted from Agent.runStream() to give the observability cross-cutting
 * concerns a single home. The wrapper exposes semantic methods so runStream()
 * reads as business logic without 46 interleaved startSpan/log.info/Timer
 * calls. The wrapper internally manages span lifecycle, timer creation,
 * usage accumulation, and log emission.
 *
 * Designed for testability: can be constructed with a mock or disabled
 * config, and all methods are safe to call regardless of initialization state.
 */

import type { ObservabilityConfig } from "../config/schema.js";
import {
	configureLogger,
	estimateCost,
	initLangfuse,
	initTelemetry,
	isLangfuseEnabled,
	type LogFields,
	log,
	makeGenerationInput,
	mergeUsage,
	NO_USAGE,
	recordGeneration,
	type SpanHandle,
	sanitizeError,
	setUsageAttributes,
	startSpan,
	Timer,
} from "../observability/index.js";
import { currentTraceId, ensureTraceContext } from "../observability/trace-context.js";
import type { TokenUsage } from "../providers/types.js";

export interface AgentObservabilityMeta {
	traceId: string;
	latencyMs: number;
	usage?: TokenUsage;
	estimatedCostUsd: number;
}

/** Config passed to beginRequest() — the model + provider context for the run. */
export interface RequestContext {
	provider: string;
	model: string;
}

/** Result of a retrieval span — used by beginRetrieval/recordRetrieval. */
export interface RetrievalResult {
	resultCount: number;
}

/** Result of an LLM call — used by recordLlmResponse. */
export interface LlmCallResult {
	usage: TokenUsage | undefined;
	content: string;
	latencyMs: number;
	timeToFirstTokenMs?: number;
}

/** Per-tool execution info for logging. */
export interface ToolLogEntry {
	name: string;
	status: "complete" | "error";
	latencyMs: number;
	error?: string;
}

export class AgentObservability {
	private _config: ObservabilityConfig | undefined;
	private _initialized: boolean = false;
	private _rootSpan: SpanHandle | undefined;
	private _totalTimer: Timer | undefined;
	private _traceId: string = "";
	private _accumulatedUsage: TokenUsage | undefined;
	private _requestFailed: boolean = false;

	constructor(config?: ObservabilityConfig) {
		this._config = config;
	}

	/** Lazily configure structured logging, OpenTelemetry, and optional Langfuse. */
	private _ensureInit(): void {
		if (this._initialized) return;
		this._initialized = true;
		const obs = this._config;
		configureLogger({
			logFullPrompts: obs?.logFullPrompts ?? false,
			previewLength: obs?.previewLength ?? 200,
		});
		if (obs?.telemetryEnabled !== false) {
			initTelemetry({ disabled: false });
		}
		if (obs?.langfuseEnabled) {
			// Fire-and-forget; failures degrade silently to disabled.
			void initLangfuse();
		}
	}

	/** Begin a request: establish trace context, root span, timer, and log start. */
	beginRequest(userPrompt: string, ctx: RequestContext): void {
		this._ensureInit();
		ensureTraceContext();
		this._traceId = currentTraceId();
		this._rootSpan = startSpan("http.request", {
			"ai.provider": ctx.provider,
			"ai.model": ctx.model,
		});
		this._totalTimer = new Timer();

		log.info({
			event: "request.start",
			traceId: this._traceId,
			provider: ctx.provider,
			model: ctx.model,
			prompt: userPrompt,
			promptLength: userPrompt.length,
		});
	}

	/** Begin a retrieval span + timer. Returns a handle to end it. */
	beginRetrieval(): { span: SpanHandle; timer: Timer } {
		const span = startSpan("retrieval");
		const timer = new Timer();
		return { span, timer };
	}

	/** End a retrieval span and log the result. */
	recordRetrieval(span: SpanHandle, timer: Timer, resultCount: number): void {
		span.setAttribute("retrieval.result_count", resultCount);
		span.setAttribute("ai.latency_ms", Math.round(timer.ms));
		span.end();
		log.info({
			event: "retrieval",
			traceId: this._traceId,
			latencyMs: Math.round(timer.ms),
			resultCount,
		});
	}

	/** End a retrieval span with an error (and rethrow). */
	recordRetrievalError(span: SpanHandle, error: unknown): never {
		span.end(error);
		throw error;
	}

	/** Begin an LLM request span + timer. Returns a handle to record the result. */
	beginLlmCall(ctx: RequestContext): { span: SpanHandle; timer: Timer } {
		const span = startSpan("llm.request", {
			"ai.provider": ctx.provider,
			"ai.model": ctx.model,
		});
		const timer = new Timer();
		return { span, timer };
	}

	/** End an LLM request span, accumulate usage, log, and optionally record to Langfuse. */
	recordLlmResponse(
		span: SpanHandle,
		_timer: Timer,
		ctx: RequestContext,
		result: LlmCallResult,
		userPrompt: string
	): void {
		const latencyMs = result.latencyMs;

		// Accumulate usage
		this._accumulatedUsage =
			this._accumulatedUsage || result.usage ? mergeUsage(this._accumulatedUsage, result.usage) : undefined;

		// Set span attributes
		const costEstimate = estimateCost(result.usage, ctx.model);
		setUsageAttributes(span, result.usage, costEstimate.estimatedCostUsd);
		span.setAttribute("ai.latency_ms", latencyMs);
		if (result.timeToFirstTokenMs !== undefined) {
			span.setAttribute("ai.time_to_first_token_ms", Math.round(result.timeToFirstTokenMs));
		}
		span.end();

		// Log
		log.info({
			event: "llm.request",
			traceId: this._traceId,
			provider: ctx.provider,
			model: ctx.model,
			latencyMs,
			usage: result.usage ?? NO_USAGE,
			estimatedCostUsd: costEstimate.estimatedCostUsd,
			response: result.content,
			responseLength: result.content.length,
			status: "ok",
		});

		// Optional Langfuse generation record (no-op when disabled).
		if (isLangfuseEnabled()) {
			recordGeneration(
				makeGenerationInput({
					traceId: this._traceId,
					name: "llm.request",
					model: ctx.model,
					input: userPrompt,
					output: result.content,
					usage: result.usage,
					latencyMs,
					estimatedCostUsd: costEstimate.estimatedCostUsd,
				})
			);
		}
	}

	/** End an LLM request span with an error. */
	recordLlmCallError(span: SpanHandle, error: unknown): void {
		span.end(error);
	}

	/** Begin a tool execution span + timer. */
	beginToolExecution(): { span: SpanHandle; timer: Timer } {
		const span = startSpan("tool.execution");
		const timer = new Timer();
		return { span, timer };
	}

	/** End a tool execution span and log each tool result. */
	recordToolResult(span: SpanHandle, timer: Timer, toolNames: string[], entries: ToolLogEntry[]): void {
		const duration = Math.round(timer.ms);
		span.setAttribute("ai.latency_ms", duration);
		span.setAttribute("tool.names", toolNames.join(","));
		span.end();

		for (const entry of entries) {
			const toolFields: LogFields = {
				event: "tool.execution",
				traceId: this._traceId,
				toolName: entry.name,
				latencyMs: duration,
				status: entry.status === "complete" ? "ok" : "error",
			};
			if (entry.status === "error" && entry.error) {
				const { errorType, errorMessage } = sanitizeError(new Error(entry.error));
				toolFields.errorType = errorType;
				toolFields.errorMessage = errorMessage;
			}
			log.info(toolFields);
		}
	}

	/** Record a request-level error (used in catch block of runStream). */
	recordRequestError(ctx: RequestContext, error: unknown): void {
		this._requestFailed = true;
		const { errorType, errorMessage } = sanitizeError(error);
		const failLatency = this._totalTimer ? Math.round(this._totalTimer.ms) : 0;
		this._rootSpan?.recordError(error);
		log.error({
			event: "request.error",
			traceId: this._traceId,
			provider: ctx.provider,
			model: ctx.model,
			latencyMs: failLatency,
			status: "error",
			errorType,
			errorMessage,
			retryCount: 0,
			usage: this._accumulatedUsage ?? NO_USAGE,
		});
	}

	/** Finalize the request: close root span and emit request.end log (finally block). */
	finalize(ctx: RequestContext): void {
		const totalLatencyMs = this._totalTimer ? Math.round(this._totalTimer.ms) : 0;
		const endCost = estimateCost(this._accumulatedUsage, ctx.model);
		this._rootSpan?.setAttributes({
			"ai.latency_ms": totalLatencyMs,
			"ai.estimated_cost_usd": endCost.estimatedCostUsd,
		});
		setUsageAttributes(this._rootSpan ?? _noopSpan, this._accumulatedUsage, endCost.estimatedCostUsd);
		this._rootSpan?.end();
		log.info({
			event: "request.end",
			traceId: this._traceId,
			provider: ctx.provider,
			model: ctx.model,
			latencyMs: totalLatencyMs,
			usage: this._accumulatedUsage ?? NO_USAGE,
			estimatedCostUsd: endCost.estimatedCostUsd,
			status: this._requestFailed ? "error" : "ok",
		});
	}

	/** Build observability metadata for the final response chunk. */
	buildMeta(model: string): AgentObservabilityMeta {
		const latencyMs = this._totalTimer ? Math.round(this._totalTimer.ms) : 0;
		const cost = estimateCost(this._accumulatedUsage, model);
		return {
			traceId: this._traceId,
			latencyMs,
			usage: this._accumulatedUsage,
			estimatedCostUsd: cost.estimatedCostUsd,
		};
	}

	/** The trace ID for the current request (empty string before beginRequest). */
	get traceId(): string {
		return this._traceId;
	}

	/** Accumulated token usage across all LLM calls in this request. */
	get accumulatedUsage(): TokenUsage | undefined {
		return this._accumulatedUsage;
	}

	/** Mark the request as failed (used when yielding an error chunk). */
	markFailed(): void {
		this._requestFailed = true;
	}
}

// No-op span handle for the finalize() edge case where rootSpan is undefined.
const _noopSpan: SpanHandle = {
	span: undefined,
	end() {},
	recordError() {},
	setAttribute() {},
	setAttributes() {},
};
