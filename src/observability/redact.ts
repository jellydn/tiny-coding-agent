/**
 * Redaction utilities for observability.
 *
 * Ensures secrets, API keys, authorization headers, and sensitive user data
 * are never emitted in logs, traces, or external telemetry.
 */

/** Keys whose values must never be logged. Matched case-insensitively. */
const SENSITIVE_KEY_PATTERNS = [
	/api[_-]?key/i,
	/secret/i,
	/password/i,
	/token/i,
	/credential/i,
	/authorization/i,
	/auth/i,
	/private[_-]?key/i,
	/access[_-]?key/i,
	/bearer/i,
	/cookie/i,
	/api[_-]?secret/i,
] as const;

/** Default truncated preview length for prompt/response content. */
export const DEFAULT_PREVIEW_LENGTH = 200;

/**
 * Returns true if a key name matches a known sensitive-field pattern.
 */
export function isSensitiveKey(key: string): boolean {
	return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Redact a single API-key-like string, preserving enough to identify which key
 * was used without exposing the secret material.
 */
export function redactSecret(value: string | undefined): string | undefined {
	if (!value) return value;
	if (value.length <= 8) return "****";
	return `${value.slice(0, 4)}...REDACTED`;
}

/**
 * Redact secret-like substrings inside free-form text (prompts/responses).
 * This is heuristic — it cannot catch every kind of secret — but it masks the
 * common shapes (api keys, bearer tokens, `password: …`, `sk-…` keys) so a
 * prompt preview never leaks credentials verbatim.
 */
export function redactTextSecrets(text: string): string {
	let out = text;
	// `sk-<long token>` style API keys (OpenAI/Anthropic-like).
	out = out.replace(/sk-[A-Za-z0-9_-]{16,}/g, "[REDACTED]");
	// `<keyword> [=:]? <value>` where keyword is a known sensitive name. The
	// value may be quoted, backtick-quoted, or a bare token (incl. long hex).
	const kw =
		"(?:api[_-]?key|apikey|secret|password|passwd|token|bearer|authorization|access[_-]?key|private[_-]?key|credential)";
	out = out.replace(
		new RegExp(`(${kw})\\s*(?::|=|\\s+is\\s+|\\s+)\\s*("(?:[^"\\\\]|\\\\.)*"|'[^']*'|\`[^\`]*\`|\\S+)`, "gi"),
		(_m, kwMatch, _val) => `${kwMatch} [REDACTED]`
	);
	return out;
}

/**
 * Produce a truncated, sanitized preview of free-form text (prompts/responses).
 * Newlines are collapsed to single spaces so the preview stays on one log line,
 * and secret-like substrings are masked before truncation.
 */
export function previewText(text: string | undefined, maxLength = DEFAULT_PREVIEW_LENGTH): string | undefined {
	if (!text) return text;
	const collapsed = redactTextSecrets(text.replace(/\s+/g, " ").trim());
	if (collapsed.length <= maxLength) return collapsed;
	return `${collapsed.slice(0, maxLength)}…`;
}

/**
 * Recursively walk an object and replace values of sensitive keys with
 * "[REDACTED]". Returns a shallow-cloned, sanitized copy. Non-sensitive
 * values are passed through untouched.
 */
export function redactObject<T>(obj: T, seen = new WeakSet()): T {
	if (obj === null || typeof obj !== "object") {
		return obj;
	}

	// Avoid infinite recursion on circular structures.
	if (seen.has(obj as object)) {
		return obj as T;
	}
	seen.add(obj as object);

	if (Array.isArray(obj)) {
		return obj.map((item) => redactObject(item, seen)) as unknown as T;
	}

	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
		if (isSensitiveKey(key)) {
			result[key] = "[REDACTED]";
		} else if (value !== null && typeof value === "object") {
			result[key] = redactObject(value, seen);
		} else {
			result[key] = value;
		}
	}
	return result as unknown as T;
}

/**
 * Redact a URL by stripping the userinfo (user:pass@) and query parameters
 * that look sensitive. Keeps the host and path for debugging connectivity.
 */
export function redactUrl(url: string | undefined): string | undefined {
	if (!url) return url;
	try {
		const parsed = new URL(url);
		parsed.username = "";
		parsed.password = "";
		// Rebuild the query string ourselves so the redaction placeholder is
		// emitted literally (`[REDACTED]`) instead of being percent-encoded.
		const kept: string[] = [];
		for (const [key, value] of parsed.searchParams.entries()) {
			kept.push(`${encodeURIComponent(key)}=${isSensitiveKey(key) ? "[REDACTED]" : encodeURIComponent(value)}`);
		}
		const search = kept.length > 0 ? `?${kept.join("&")}` : "";
		return `${parsed.protocol}//${parsed.host}${parsed.pathname}${search}${parsed.hash}`;
	} catch {
		// Not a valid URL — return a placeholder rather than the raw string.
		return "[invalid-url]";
	}
}
