/**
 * Request trace context.
 *
 * Each incoming "request" (an agent run / CLI invocation) gets a unique
 * `traceId` that propagates through the agent loop, retrieval, tool execution,
 * and the LLM provider call. Context is carried via `AsyncLocalStorage` so
 * concurrent requests never mix their trace contexts.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface TraceContext {
	/** Unique identifier for the whole request. */
	traceId: string;
	/** Identifier of the currently-active span within the trace. */
	spanId: string;
	/** Stack of OpenTelemetry spans, used to nest child spans correctly. */
	spanStack: unknown[];
	/** Accumulated latency markers for phases of the request. */
	marks: Record<string, number>;
}

const storage = new AsyncLocalStorage<TraceContext>();

/**
 * Generate a fresh trace id. Uses crypto.randomUUID without dashes so it is a
 * clean 32-char hex string compatible with OTel trace ids.
 */
export function generateTraceId(): string {
	return randomUUID().replace(/-/g, "");
}

/** Short, unique span id. */
export function generateSpanId(): string {
	return randomUUID().replace(/-/g, "").slice(0, 16);
}

/**
 * Run `fn` inside a new trace context and return its result. The context is
 * isolated to this async chain, so concurrent calls each see their own trace.
 */
export function runWithContext<T>(traceId: string, fn: () => Promise<T>): Promise<T> {
	const ctx: TraceContext = {
		traceId,
		spanId: generateSpanId(),
		spanStack: [],
		marks: {},
	};
	return storage.run(ctx, fn);
}

/**
 * Run `fn` with an explicit context (used to propagate a parent trace id into
 * a nested async boundary). Returns the result of `fn`.
 */
export function runWithExistingContext<T>(ctx: TraceContext, fn: () => Promise<T>): Promise<T> {
	return storage.run(ctx, fn);
}

/**
 * Return the active trace context, or create one and bind it to the current
 * async chain via `enterWith`. Use this in async generators (which cannot use
 * `storage.run`) so context persists across `yield`/`await` resumptions.
 */
export function ensureTraceContext(traceId?: string): TraceContext {
	const existing = storage.getStore();
	if (existing) return existing;
	const ctx: TraceContext = {
		traceId: traceId ?? generateTraceId(),
		spanId: generateSpanId(),
		spanStack: [],
		marks: {},
	};
	storage.enterWith(ctx);
	return ctx;
}

/** The current trace context, or undefined when not inside a request. */
export function getTraceContext(): TraceContext | undefined {
	return storage.getStore();
}

/** The current trace id, or a fallback when no context is active. */
export function currentTraceId(): string {
	return storage.getStore()?.traceId ?? "no-trace";
}

/** Push a span onto the active context's span stack. No-op without a context. */
export function pushSpan(span: unknown): void {
	const ctx = storage.getStore();
	if (ctx) ctx.spanStack.push(span);
}

/** Pop the most recent span from the active context's stack. */
export function popSpan(): unknown {
	const ctx = storage.getStore();
	return ctx?.spanStack.pop();
}

/** Read the most recent span without removing it. */
export function currentSpan(): unknown {
	const ctx = storage.getStore();
	return ctx?.spanStack.at(-1);
}

/** Record a named timing mark on the active context. */
export function mark(name: string, value: number): void {
	const ctx = storage.getStore();
	if (ctx) ctx.marks[name] = value;
}
