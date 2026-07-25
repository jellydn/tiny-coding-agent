/**
 * Structured JSON logger for observability.
 *
 * Emits one JSON object per log line with the canonical observability fields.
 * Secrets are never logged: prompt content is redacted+truncated by default,
 * and full-prompt logging is opt-in (disabled by default).
 */
import { previewText, redactObject, redactSecret } from "./redact.js";
import { isUsageUnavailable, type TokenUsage } from "./token-usage.js";
import { currentTraceId, getTraceContext } from "./trace-context.js";

export interface ObservabilityConfig {
	/** When true, log full prompt/response text (NOT just a preview). Default: false. */
	logFullPrompts?: boolean;
	/** Max preview length for prompt/response content. Default: 200. */
	previewLength?: number;
	/** Custom sink (defaults to console.log). Useful for tests. */
	sink?: (line: string) => void;
	/** Minimum event level to emit. Default: "info". */
	level?: LogLevel;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Canonical log fields. */
export interface LogFields {
	traceId?: string;
	spanId?: string;
	event: string;
	model?: string;
	provider?: string;
	prompt?: string;
	response?: string;
	usage?: TokenUsage;
	level?: LogLevel;
	toolName?: string;
	resultCount?: number;
	promptPreview?: string;
	promptLength?: number;
	responseLength?: number;
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
	cachedTokens?: number;
	reasoningTokens?: number;
	latencyMs?: number;
	estimatedCostUsd?: number;
	status?: "ok" | "error";
	errorType?: string;
	errorMessage?: string;
	retryCount?: number;
	timestamp?: string;
	[key: string]: unknown;
}

let _config: ObservabilityConfig = {
	logFullPrompts: false,
	previewLength: 200,
	level: "info",
};

/** Update the global logger configuration. */
export function configureLogger(config: Partial<ObservabilityConfig>): void {
	_config = { ..._config, ...config };
}

/** Current logger configuration (for inspection in tests). */
export function getLoggerConfig(): ObservabilityConfig {
	return _config;
}

/**
 * Build the JSON-safe payload for a log event, applying redaction and preview
 * rules. Exposed for testing without touching the sink.
 */
export function buildLogRecord(fields: LogFields, config: ObservabilityConfig = _config): Record<string, unknown> {
	const ctx = getTraceContext();
	const traceId = fields.traceId ?? ctx?.traceId ?? "no-trace";
	const spanId = fields.spanId ?? ctx?.spanId ?? undefined;

	const record: Record<string, unknown> = {
		timestamp: fields.timestamp ?? new Date().toISOString(),
		traceId,
		event: fields.event,
	};
	if (spanId) record.spanId = spanId;
	if (fields.model) record.model = fields.model;
	if (fields.provider) record.provider = fields.provider;
	if (fields.latencyMs !== undefined) record.latencyMs = fields.latencyMs;
	if (fields.status) record.status = fields.status;
	if (fields.retryCount !== undefined) record.retryCount = fields.retryCount;
	if (fields.errorType) record.errorType = fields.errorType;
	if (fields.errorMessage) record.errorMessage = fields.errorMessage;

	// Prompt/response content: full vs redacted preview.
	if (fields.prompt !== undefined) {
		if (config.logFullPrompts) {
			record.prompt = fields.prompt;
		} else {
			record.promptPreview = previewText(fields.prompt, config.previewLength);
		}
	}
	if (fields.response !== undefined) {
		if (config.logFullPrompts) {
			record.response = fields.response;
		} else {
			record.responsePreview = previewText(fields.response, config.previewLength);
		}
	}
	if (fields.promptLength !== undefined) record.promptLength = fields.promptLength;
	if (fields.responseLength !== undefined) record.responseLength = fields.responseLength;

	// Token usage: only emit when the provider actually returned data.
	if (fields.usage && !isUsageUnavailable(fields.usage)) {
		record.inputTokens = fields.usage.inputTokens;
		record.outputTokens = fields.usage.outputTokens;
		record.totalTokens = fields.usage.totalTokens;
		record.cachedTokens = fields.usage.cachedTokens;
		record.reasoningTokens = fields.usage.reasoningTokens;
	} else if (fields.usage !== undefined) {
		record.usage = "unavailable";
	}
	if (fields.estimatedCostUsd !== undefined) record.estimatedCostUsd = fields.estimatedCostUsd;

	// Any extra fields, redacted.
	for (const [key, value] of Object.entries(fields)) {
		if (EXTRA_KEYS.has(key)) continue;
		if (value !== undefined) {
			record[key] = redactObject(value);
		}
	}

	return record;
}

// Field names handled explicitly above; everything else is treated as extra.
const EXTRA_KEYS = new Set<string>([
	"traceId",
	"spanId",
	"event",
	"model",
	"provider",
	"promptPreview",
	"promptLength",
	"responseLength",
	"inputTokens",
	"outputTokens",
	"totalTokens",
	"cachedTokens",
	"reasoningTokens",
	"latencyMs",
	"estimatedCostUsd",
	"status",
	"errorType",
	"errorMessage",
	"retryCount",
	"timestamp",
	"prompt",
	"response",
	"usage",
	"level",
	"toolName",
	"resultCount",
]);

/** Emit a structured log line. */
export function logEvent(fields: LogFields): void {
	const level = (fields.level as LogLevel) ?? "info";
	const minLevel = _config.level ?? "info";
	if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;

	const record = buildLogRecord(fields, _config);
	const sink = _config.sink ?? ((line: string) => console.log(line));
	try {
		sink(JSON.stringify(record));
	} catch (err) {
		// The logger must never break user requests. Fall back to a minimal line.
		try {
			sink(JSON.stringify({ traceId: currentTraceId(), event: fields.event, logError: (err as Error).message }));
		} catch {
			// give up silently
		}
	}
}

/** Convenience helpers. */
export const log = {
	info: (fields: LogFields): void => logEvent({ ...fields, level: "info" }),
	warn: (fields: LogFields): void => logEvent({ ...fields, level: "warn" }),
	error: (fields: LogFields): void => logEvent({ ...fields, level: "error" }),
	debug: (fields: LogFields): void => logEvent({ ...fields, level: "debug" }),
};

/** Sanitize an error for logging: type + message, never a full stack trace. */
export function sanitizeError(err: unknown): { errorType: string; errorMessage: string } {
	if (err instanceof Error) {
		return { errorType: err.name, errorMessage: redactSecret(err.message) ?? err.message };
	}
	return { errorType: "UnknownError", errorMessage: String(err) };
}

/** Re-export the usage type for callers. */
export type { TokenUsage };
