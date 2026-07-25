/**
 * Optional Langfuse integration.
 *
 * Activated only when `LANGFUSE_SECRET_KEY` and `LANGFUSE_PUBLIC_KEY`
 * environment variables are both set. The `langfuse` package is loaded lazily
 * so the application continues to work when it is not installed or when the
 * Langfuse backend is unreachable. Observability failures never break user
 * requests — every public method is wrapped in try/catch and degrades to a
 * no-op.
 */

import type { TokenUsage } from "./token-usage.js";
import { currentTraceId } from "./trace-context.js";

export interface LangfuseConfig {
	secretKey?: string;
	publicKey?: string;
	baseUrl?: string;
	/** Custom flush interval (ms). */
	flushAt?: number;
}

export interface LangfuseGenerationInput {
	traceId: string;
	name: string;
	model: string;
	input: unknown;
	output?: unknown;
	usage?: TokenUsage;
	latencyMs?: number;
	estimatedCostUsd?: number;
	error?: unknown;
	metadata?: Record<string, unknown>;
}

interface LangfuseClient {
	trace(args: { id?: string; name: string }): {
		generation(args: Record<string, unknown>): { id: string };
	};
	flushAsync(): Promise<void>;
	shutdown(): void;
}

let client: LangfuseClient | undefined | null; // null = attempted & failed
let enabled = false;

/** True when Langfuse is enabled and the client loaded successfully. */
export function isLangfuseEnabled(): boolean {
	return enabled && client !== undefined && client !== null;
}

/**
 * Initialize Langfuse from environment variables. Safe to call repeatedly.
 * Sets `enabled = false` when env vars are missing or the package fails to load.
 */
export async function initLangfuse(config: LangfuseConfig = {}): Promise<void> {
	if (client !== undefined) return; // already attempted

	const secretKey = config.secretKey ?? process.env.LANGFUSE_SECRET_KEY;
	const publicKey = config.publicKey ?? process.env.LANGFUSE_PUBLIC_KEY;

	if (!secretKey || !publicKey) {
		enabled = false;
		client = null;
		return;
	}

	try {
		const mod = (await import("langfuse")) as { Langfuse: new (opts: Record<string, unknown>) => LangfuseClient };
		client = new mod.Langfuse({
			secretKey,
			publicKey,
			baseUrl: config.baseUrl ?? process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com",
			flushAt: config.flushAt ?? 1,
		});
		enabled = true;
	} catch {
		// Package missing or constructor failed — degrade silently.
		enabled = false;
		client = null;
	}
}

/** Reset state (for tests). */
export function resetLangfuse(): void {
	try {
		client?.shutdown();
	} catch {
		// ignore
	}
	client = undefined;
	enabled = false;
}

function sanitize(value: unknown): unknown {
	// Avoid logging raw secrets inside prompt/response objects.
	if (typeof value === "string") return value;
	if (value === null || typeof value !== "object") return value;
	try {
		return JSON.parse(JSON.stringify(value));
	} catch {
		return "[unserializable]";
	}
}

/**
 * Record an LLM generation against a Langfuse trace. No-op when disabled.
 */
export function recordGeneration(input: LangfuseGenerationInput): void {
	if (!isLangfuseEnabled() || !client) return;
	try {
		const trace = client.trace({ id: input.traceId, name: input.name });
		const usage = input.usage
			? {
					promptTokens: input.usage.inputTokens,
					completionTokens: input.usage.outputTokens,
					totalTokens: input.usage.totalTokens,
				}
			: undefined;
		trace.generation({
			name: input.name,
			model: input.model,
			input: sanitize(input.input),
			output: sanitize(input.output),
			usage,
			metadata: {
				latencyMs: input.latencyMs,
				estimatedCostUsd: input.estimatedCostUsd,
				...(input.metadata ?? {}),
			},
			level: input.error ? "ERROR" : "DEFAULT",
			statusMessage: input.error ? errorMessage(input.error) : undefined,
		});
	} catch {
		// never break the request
	}
}

/** Flush pending events to Langfuse. */
export async function flushLangfuse(): Promise<void> {
	if (!isLangfuseEnabled() || !client) return;
	try {
		await client.flushAsync();
	} catch {
		// ignore
	}
}

/** Shut down the Langfuse client. */
export function shutdownLangfuse(): void {
	try {
		client?.shutdown();
	} catch {
		// ignore
	}
}

function errorMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}

/** Helper to build a generation input bound to the current trace id. */
export function makeGenerationInput(
	partial: Omit<LangfuseGenerationInput, "traceId"> & { traceId?: string }
): LangfuseGenerationInput {
	return { traceId: partial.traceId ?? currentTraceId(), ...partial };
}
