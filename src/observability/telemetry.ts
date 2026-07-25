/**
 * OpenTelemetry tracing setup.
 *
 * Creates spans for: HTTP/CLI request → retrieval → tool execution → LLM
 * request, with useful `ai.*` / `tool.*` / `retrieval.*` attributes. Errors
 * are recorded on spans. Uses a console exporter locally; the exporter is
 * configurable so an OTLP backend can be added later.
 *
 * Telemetry never becomes a single point of failure: if the OTel packages fail
 * to load or a span operation throws, callers receive a no-op span and the
 * request continues.
 */
import { context, DiagConsoleLogger, DiagLogLevel, diag, type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import {
	BasicTracerProvider,
	ConsoleSpanExporter,
	SimpleSpanProcessor,
	type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { TokenUsage } from "./token-usage.js";
import { currentSpan, popSpan, pushSpan } from "./trace-context.js";

/** Attribute keys used across spans. */
export const SpanAttributes = {
	aiProvider: "ai.provider",
	aiModel: "ai.model",
	aiInputTokens: "ai.input_tokens",
	aiOutputTokens: "ai.output_tokens",
	aiTotalTokens: "ai.total_tokens",
	aiCachedTokens: "ai.cached_tokens",
	aiReasoningTokens: "ai.reasoning_tokens",
	aiEstimatedCostUsd: "ai.estimated_cost_usd",
	aiLatencyMs: "ai.latency_ms",
	aiTimeToFirstTokenMs: "ai.time_to_first_token_ms",
	toolName: "tool.name",
	toolStatus: "tool.status",
	retrievalResultCount: "retrieval.result_count",
} as const;

export interface TelemetryConfig {
	/** Custom span processor(s); defaults to a console exporter. */
	spanProcessors?: SpanProcessor[];
	/** Disable telemetry entirely. */
	disabled?: boolean;
}

let provider: BasicTracerProvider | undefined;
let tracer: ReturnType<BasicTracerProvider["getTracer"]> | undefined;
let initialized = false;
let telemetryDisabled = false;

/**
 * Initialize the global tracer provider. Safe to call multiple times. Building
 * the provider/tracer only happens once unless `spanProcessors` is supplied
 * (which forces a re-build). The `disabled` flag can always be toggled without
 * rebuilding, so callers (and tests) can turn telemetry off at any time.
 */
export function initTelemetry(config: TelemetryConfig = {}): void {
	// Always honor an explicit `disabled` toggle, even after initialization.
	if (config.disabled !== undefined) telemetryDisabled = config.disabled;

	if (initialized && !config.spanProcessors) {
		initialized = true;
		return;
	}
	try {
		diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.NONE);
		const processors = config.spanProcessors ?? [new SimpleSpanProcessor(new ConsoleSpanExporter())];
		provider = new BasicTracerProvider({ spanProcessors: processors });
		tracer = provider.getTracer("tiny-agent");
		telemetryDisabled = config.disabled ?? false;
		initialized = true;
	} catch {
		// Degrade to no-op telemetry.
		telemetryDisabled = true;
		initialized = true;
	}
}

/** Flush all pending spans. */
export async function shutdownTelemetry(): Promise<void> {
	try {
		await provider?.shutdown();
	} catch {
		// ignore
	}
}

/** True when telemetry has been initialized and is not disabled. */
export function isTelemetryEnabled(): boolean {
	return initialized && !telemetryDisabled && tracer !== undefined;
}

/**
 * A handle for a started span. Always safe to call `.end()` / `.recordError()`
 * / `.setAttribute()` on it, even when telemetry is disabled (no-op).
 */
export interface SpanHandle {
	/** The underlying OTel span, or undefined when disabled. */
	span: Span | undefined;
	/** End the span, optionally recording an error first. */
	end(error?: unknown): void;
	/** Record an error on the span without ending it. */
	recordError(error: unknown): void;
	/** Set a string/number/boolean attribute. */
	setAttribute(key: string, value: string | number | boolean): void;
	/** Set several attributes at once. */
	setAttributes(attrs: Record<string, string | number | boolean>): void;
}

const NOOP_HANDLE: SpanHandle = {
	span: undefined,
	end() {},
	recordError() {},
	setAttribute() {},
	setAttributes() {},
};

/**
 * Start a span, parented to the current span in the active trace context.
 * The span is pushed onto the trace context's span stack so nested `startSpan`
 * calls chain correctly. Remember to call `.end()`.
 */
export function startSpan(name: string, attrs?: Record<string, string | number | boolean>): SpanHandle {
	if (!isTelemetryEnabled() || !tracer) return NOOP_HANDLE;
	try {
		const parent = currentSpan() as Span | undefined;
		const parentCtx = parent ? trace.setSpan(context.active(), parent) : context.active();
		const span = tracer.startSpan(name, undefined, parentCtx);
		if (attrs) {
			for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v);
		}
		pushSpan(span);
		return makeHandle(span);
	} catch {
		return NOOP_HANDLE;
	}
}

function makeHandle(span: Span): SpanHandle {
	return {
		span,
		end(error?: unknown) {
			try {
				if (error !== undefined) {
					span.recordException(error as Exception);
					span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage(error) });
				}
				span.end();
			} catch {
				// ignore
			} finally {
				popSpan();
			}
		},
		recordError(error: unknown) {
			try {
				span.recordException(error as Exception);
				span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage(error) });
			} catch {
				// ignore
			}
		},
		setAttribute(key, value) {
			try {
				span.setAttribute(key, value);
			} catch {
				// ignore
			}
		},
		setAttributes(attrs) {
			try {
				for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v);
			} catch {
				// ignore
			}
		},
	};
}

/** Attach token-usage + cost attributes to an LLM span. */
export function setUsageAttributes(handle: SpanHandle, usage: TokenUsage | undefined, estimatedCostUsd?: number): void {
	if (!usage) {
		handle.setAttribute("ai.usage", "unavailable");
		return;
	}
	if (usage.inputTokens !== undefined) handle.setAttribute(SpanAttributes.aiInputTokens, usage.inputTokens);
	if (usage.outputTokens !== undefined) handle.setAttribute(SpanAttributes.aiOutputTokens, usage.outputTokens);
	if (usage.totalTokens !== undefined) handle.setAttribute(SpanAttributes.aiTotalTokens, usage.totalTokens);
	if (usage.cachedTokens !== undefined) handle.setAttribute(SpanAttributes.aiCachedTokens, usage.cachedTokens);
	if (usage.reasoningTokens !== undefined) handle.setAttribute(SpanAttributes.aiReasoningTokens, usage.reasoningTokens);
	if (estimatedCostUsd !== undefined) handle.setAttribute(SpanAttributes.aiEstimatedCostUsd, estimatedCostUsd);
}

function errorMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}

// `Exception` is the OTel type for recordException input.
type Exception = string | Error;
