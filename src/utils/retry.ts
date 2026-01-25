/**
 * Retry configuration options
 */
export interface RetryOptions {
	/** Maximum number of retry attempts (default: 5) */
	maxRetries?: number;
	/** Initial delay in milliseconds (default: 1000) */
	initialDelay?: number;
	/** Maximum delay in milliseconds (default: 30000) */
	maxDelay?: number;
	/** Multiplier for exponential backoff (default: 2) */
	multiplier?: number;
	/** Whether to add jitter to delays (default: true) */
	jitter?: boolean;
	/** Custom retry condition function */
	shouldRetry?: (error: unknown, attempt: number) => boolean | Promise<boolean>;
}

/**
 * Default retry options
 */
const DEFAULT_RETRY_OPTIONS = {
	maxRetries: 5,
	initialDelay: 1000,
	maxDelay: 30000,
	multiplier: 2,
	jitter: true,
} satisfies RetryOptions;

/**
 * Calculate delay with exponential backoff and optional jitter
 */
function calculateDelay(attempt: number, options: Required<RetryOptions>): number {
	// Exponential backoff: delay = initialDelay * (multiplier ^ attempt)
	const exponentialDelay = options.initialDelay * options.multiplier ** attempt;

	// Cap at max delay
	const cappedDelay = Math.min(exponentialDelay, options.maxDelay);

	// Add jitter to prevent thundering herd (±25% of delay)
	if (options.jitter) {
		const jitterRange = cappedDelay * 0.25;
		return cappedDelay - jitterRange / 2 + Math.random() * jitterRange;
	}

	return cappedDelay;
}

/**
 * Default retry condition for common API errors
 */
function isRetryableError(error: unknown, _attempt: number): boolean {
	if (error instanceof Error) {
		// Check for rate limit errors
		if (
			error.message.includes("rate limit") ||
			error.message.includes("429") ||
			error.message.includes("too many requests")
		) {
			return true;
		}

		// Check for network errors that might be transient
		if (
			error.message.includes("ECONNRESET") ||
			error.message.includes("ETIMEDOUT") ||
			error.message.includes("ENOTFOUND") ||
			error.message.includes("ECONNREFUSED")
		) {
			return true;
		}
	}

	return false;
}

/**
 * Retry a function with exponential backoff
 *
 * @example
 * ```typescript
 * const result = await retryWithBackoff(
 *   async () => await apiCall(),
 *   { maxRetries: 3 }
 * );
 * ```
 */
export async function retryWithBackoff<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
	const opts = {
		maxRetries: options.maxRetries ?? DEFAULT_RETRY_OPTIONS.maxRetries,
		initialDelay: options.initialDelay ?? DEFAULT_RETRY_OPTIONS.initialDelay,
		maxDelay: options.maxDelay ?? DEFAULT_RETRY_OPTIONS.maxDelay,
		multiplier: options.multiplier ?? DEFAULT_RETRY_OPTIONS.multiplier,
		jitter: options.jitter ?? DEFAULT_RETRY_OPTIONS.jitter,
		shouldRetry: options.shouldRetry ?? isRetryableError,
	};

	let lastError: unknown;

	for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error;

			// Check if we should retry
			const shouldRetry = await opts.shouldRetry(error, attempt);

			// Don't retry if this is the last attempt or error is not retryable
			if (attempt === opts.maxRetries || !shouldRetry) {
				throw error;
			}

			// Calculate delay and wait before retrying
			const delay = calculateDelay(attempt, opts);

			// Log retry attempt (only in verbose mode would be better, but console.warn for now)
			if (error instanceof Error) {
				console.warn(
					`[Retry] Attempt ${attempt + 1}/${opts.maxRetries + 1} failed: ${error.message}. Retrying in ${Math.round(delay)}ms...`
				);
			}

			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}

	// This should never be reached, but TypeScript needs it
	throw lastError;
}

/**
 * Create a retryable version of any async function
 *
 * @example
 * ```typescript
 * const retryableFetch = makeRetryable(fetch, { maxRetries: 3 });
 * const response = await retryableFetch(url);
 * ```
 */
export function makeRetryable<T extends (...args: unknown[]) => Promise<unknown>>(
	fn: T,
	options: RetryOptions = {}
): T {
	return ((...args: Parameters<T>) => retryWithBackoff(() => fn(...args), options)) as T;
}
