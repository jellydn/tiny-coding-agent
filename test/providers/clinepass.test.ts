import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { ClinePassProvider } from "../../src/providers/clinepass.js";
import { isModelInCatalog } from "../../src/providers/models-dev.js";
import { OpenAIProvider } from "../../src/providers/openai.js";

const DEFAULT_BASE_URL = "https://api.cline.bot/v1";
const CUSTOM_BASE_URL = "https://custom.example.com/v1";
const MODELS_URL = "https://api.cline.bot/api/v1/models";
const CUSTOM_MODELS_URL = "https://custom.example.com/api/v1/models";

/** Coerce a `fetch` input (string | URL | Request) to a URL string. */
function toUrlString(input: string | URL | Request): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.toString();
	return input.url;
}

/** Build a 200 response with a /api/v1/models body listing the given ids. */
function modelsListResponse(modelIds: string[]): Response {
	return new Response(JSON.stringify({ data: modelIds.map((id) => ({ id })) }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

// Minimal spy type — bun:test's MockedFunction requires verbose generics.
// We only use .mockImplementation, .mockRestore, and .mock.calls.length.
type FetchSpy = {
	(...args: Parameters<typeof fetch>): Promise<Response>;
	mockImplementation(fn: (...args: Parameters<typeof fetch>) => Promise<Response>): unknown;
	mockRestore(): void;
	mock: { calls: unknown[][] };
};

describe("ClinePassProvider", () => {
	describe("constructor", () => {
		it("should default baseUrl to https://api.cline.bot/v1 and forward it to the parent", () => {
			const provider = new ClinePassProvider({ apiKey: "test-key" });
			expect(provider).toBeInstanceOf(ClinePassProvider);
			// Inherits from OpenAIProvider so it satisfies the LLMClient contract.
			expect(provider).toBeInstanceOf(OpenAIProvider);
			// Asserts the resolved baseUrl actually flows into the provider, not just
			// that construction accepts the config surface.
			expect(provider.getResolvedBaseUrl()).toBe(DEFAULT_BASE_URL);
		});

		it("should accept and forward a custom baseUrl", () => {
			const provider = new ClinePassProvider({
				apiKey: "test-key",
				baseUrl: CUSTOM_BASE_URL,
			});
			expect(provider).toBeInstanceOf(ClinePassProvider);
			expect(provider.getResolvedBaseUrl()).toBe(CUSTOM_BASE_URL);
		});

		it("should retain the custom baseUrl even when it equals the upstream default", () => {
			// Defends against an accidental `||` short-circuit that drops an
			// explicit-but-equal baseUrl.
			const provider = new ClinePassProvider({
				apiKey: "test-key",
				baseUrl: DEFAULT_BASE_URL,
			});
			expect(provider.getResolvedBaseUrl()).toBe(DEFAULT_BASE_URL);
		});
	});

	describe("getCapabilities()", () => {
		let fetchSpy: FetchSpy;

		beforeEach(() => {
			fetchSpy = spyOn(globalThis, "fetch") as unknown as FetchSpy;
		});

		afterEach(() => {
			fetchSpy.mockRestore();
		});

		// ─── Happy path: model is in the live list ─────────────────────────

		it("should return API-confirmed capabilities for a model in the live list", async () => {
			fetchSpy.mockImplementation(async (input) => {
				if (toUrlString(input).endsWith("/api/v1/models")) {
					return modelsListResponse(["cline-pass/glm-5.2", "cline-pass/kimi-k3"]);
				}
				return new Response("not found", { status: 404 });
			});
			const provider = new ClinePassProvider({ apiKey: "test-key" });
			const caps = await provider.getCapabilities("cline-pass/glm-5.2");
			expect(caps.modelName).toBe("cline-pass/glm-5.2");
			expect(caps.supportsTools).toBe(true);
			expect(caps.supportsStreaming).toBe(true);
			expect(caps.supportsThinking).toBe(true);
			expect(caps.contextWindow).toBe(128000);
			expect(caps.maxOutputTokens).toBe(8192);
			expect(caps.isVerified).toBe(true);
			expect(caps.source).toBe("api");
		});

		it("should return API-confirmed capabilities for every model in the live list", async () => {
			const modelIds = [
				"cline-pass/glm-5.2",
				"cline-pass/deepseek-v4-pro",
				"cline-pass/deepseek-v4-flash",
				"cline-pass/kimi-k2.7-code",
				"cline-pass/kimi-k3",
				"cline-pass/qwen3.7-max",
				"cline-pass/qwen3.7-plus",
				"cline-pass/mimo-v2.5",
			];
			fetchSpy.mockImplementation(async (input) => {
				if (toUrlString(input).endsWith("/api/v1/models")) {
					return modelsListResponse(modelIds);
				}
				return new Response("not found", { status: 404 });
			});
			const provider = new ClinePassProvider({ apiKey: "test-key" });
			for (const model of modelIds) {
				const caps = await provider.getCapabilities(model);
				expect(caps.modelName).toBe(model);
				expect(caps.isVerified).toBe(true);
				expect(caps.source).toBe("api");
			}
		});

		// ─── Fall-through paths ─────────────────────────────────────────────

		it("should fall through to OpenAI defaults when the model is not in the live list", async () => {
			fetchSpy.mockImplementation(async (input) => {
				if (toUrlString(input).endsWith("/api/v1/models")) {
					return modelsListResponse(["cline-pass/kimi-k3"]); // marker not in list
				}
				return new Response("not found", { status: 404 });
			});
			const unknownId = "cline-pass/__definitely-not-in-catalog__";
			// Defensive: the OpenAI-parent's catalog path also doesn't
			// intercept this marker id, so the hardcoded fallback runs.
			expect(isModelInCatalog(unknownId, "openai")).toBe(false);
			const provider = new ClinePassProvider({ apiKey: "test-key" });
			const caps = await provider.getCapabilities(unknownId);
			expect(caps.modelName).toBe(unknownId);
			// The ClinePass default profile reports supportsThinking=true,
			// contextWindow=128000, maxOutputTokens=8192. The OpenAI-parent
			// fallback returns the contrasting values below, so a regression
			// that always returned the ClinePass default would fail at least
			// one of these assertions.
			expect(caps.supportsThinking).toBe(false);
			expect(caps.contextWindow).toBe(16385);
			expect(caps.maxOutputTokens).toBe(4096);
			expect(caps.source).toBe("fallback");
		});

		it("should fall through to OpenAI defaults on fetch network error", async () => {
			fetchSpy.mockImplementation(async () => {
				throw new Error("network unreachable");
			});
			const provider = new ClinePassProvider({ apiKey: "test-key" });
			const caps = await provider.getCapabilities("cline-pass/glm-5.2");
			expect(caps.source).toBe("fallback");
			expect(caps.supportsThinking).toBe(false);
		});

		it("should fall through to OpenAI defaults on non-200 response", async () => {
			fetchSpy.mockImplementation(async () => {
				return new Response("rate limited", { status: 429 });
			});
			const provider = new ClinePassProvider({ apiKey: "test-key" });
			const caps = await provider.getCapabilities("cline-pass/glm-5.2");
			expect(caps.source).toBe("fallback");
		});

		it("should fall through to OpenAI defaults on malformed JSON", async () => {
			fetchSpy.mockImplementation(async () => {
				return new Response("not json at all", {
					status: 200,
					headers: { "Content-Type": "text/plain" },
				});
			});
			const provider = new ClinePassProvider({ apiKey: "test-key" });
			const caps = await provider.getCapabilities("cline-pass/glm-5.2");
			expect(caps.source).toBe("fallback");
		});

		it("should fall through to OpenAI defaults when the response has no `data` field", async () => {
			fetchSpy.mockImplementation(async () => {
				return new Response(JSON.stringify({}), { status: 200 });
			});
			const provider = new ClinePassProvider({ apiKey: "test-key" });
			const caps = await provider.getCapabilities("cline-pass/glm-5.2");
			expect(caps.source).toBe("fallback");
		});

		// ─── Caching behaviour ──────────────────────────────────────────────

		it("should memoize per-id (same model returns the same reference on repeat)", async () => {
			fetchSpy.mockImplementation(async (input) => {
				if (toUrlString(input).endsWith("/api/v1/models")) {
					return modelsListResponse(["cline-pass/glm-5.2"]);
				}
				return new Response("not found", { status: 404 });
			});
			const provider = new ClinePassProvider({ apiKey: "test-key" });
			const first = await provider.getCapabilities("cline-pass/glm-5.2");
			const second = await provider.getCapabilities("cline-pass/glm-5.2");
			expect(first).toBe(second);
		});

		it("should fetch the models list once per provider instance even for many lookups", async () => {
			fetchSpy.mockImplementation(async (input) => {
				if (toUrlString(input).endsWith("/api/v1/models")) {
					return modelsListResponse(["cline-pass/glm-5.2", "cline-pass/kimi-k3", "cline-pass/another-in-list"]);
				}
				return new Response("not found", { status: 404 });
			});
			const provider = new ClinePassProvider({ apiKey: "test-key" });
			await provider.getCapabilities("cline-pass/glm-5.2");
			await provider.getCapabilities("cline-pass/kimi-k3");
			await provider.getCapabilities("cline-pass/another-in-list");
			// All three lookups share the same per-instance list promise.
			expect(fetchSpy.mock.calls.length).toBe(1);
		});

		it("should fetch the list once when getCapabilities is called concurrently", async () => {
			fetchSpy.mockImplementation(async (input) => {
				if (toUrlString(input).endsWith("/api/v1/models")) {
					return modelsListResponse(["cline-pass/glm-5.2", "cline-pass/kimi-k3"]);
				}
				return new Response("not found", { status: 404 });
			});
			const provider = new ClinePassProvider({ apiKey: "test-key" });
			await Promise.all([
				provider.getCapabilities("cline-pass/glm-5.2"),
				provider.getCapabilities("cline-pass/kimi-k3"),
			]);
			expect(fetchSpy.mock.calls.length).toBe(1);
		});

		it("should cache the negative (not-in-list) result without re-fetching", async () => {
			fetchSpy.mockImplementation(async (input) => {
				if (toUrlString(input).endsWith("/api/v1/models")) {
					return modelsListResponse(["cline-pass/kimi-k3"]);
				}
				return new Response("not found", { status: 404 });
			});
			const provider = new ClinePassProvider({ apiKey: "test-key" });
			const first = await provider.getCapabilities("cline-pass/__unknown__");
			const second = await provider.getCapabilities("cline-pass/__unknown__");
			// Same reference — the negative result is memoized, not re-evaluated.
			expect(first).toBe(second);
			expect(fetchSpy.mock.calls.length).toBe(1);
		});

		it("should NOT cache the fallback when the list fetch fails (so the next call retries)", async () => {
			let attempt = 0;
			fetchSpy.mockImplementation(async () => {
				attempt++;
				throw new Error("network unreachable");
			});
			const provider = new ClinePassProvider({ apiKey: "test-key" });
			const first = await provider.getCapabilities("cline-pass/glm-5.2");
			expect(first.source).toBe("fallback");
			// Second call should re-attempt the list fetch (not return the
			// cached fallback).
			const second = await provider.getCapabilities("cline-pass/glm-5.2");
			expect(second.source).toBe("fallback");
			expect(attempt).toBe(2);
		});

		it("should retry the list fetch after a failure and succeed on a later call", async () => {
			let attempt = 0;
			fetchSpy.mockImplementation(async () => {
				attempt++;
				if (attempt === 1) {
					throw new Error("network unreachable");
				}
				return modelsListResponse(["cline-pass/glm-5.2"]);
			});
			const provider = new ClinePassProvider({ apiKey: "test-key" });
			const first = await provider.getCapabilities("cline-pass/glm-5.2");
			expect(first.source).toBe("fallback");
			const second = await provider.getCapabilities("cline-pass/glm-5.2");
			expect(second.source).toBe("api");
			expect(attempt).toBe(2);
		});

		// ─── HTTP request shape ─────────────────────────────────────────────

		it("should pass the Authorization header with the configured API key", async () => {
			let capturedAuth: string | undefined;
			fetchSpy.mockImplementation(async (_input, init) => {
				const headers = new Headers(init?.headers);
				capturedAuth = headers.get("Authorization") ?? undefined;
				return modelsListResponse([]);
			});
			const provider = new ClinePassProvider({ apiKey: "my-secret-key" });
			await provider.getCapabilities("cline-pass/glm-5.2");
			expect(capturedAuth).toBe("Bearer my-secret-key");
		});

		it("should hit /api/v1/models (not /v1/models) for the upstream list", async () => {
			let capturedUrl: string | undefined;
			fetchSpy.mockImplementation(async (input) => {
				capturedUrl = toUrlString(input);
				return modelsListResponse([]);
			});
			const provider = new ClinePassProvider({ apiKey: "test-key" });
			await provider.getCapabilities("cline-pass/glm-5.2");
			expect(capturedUrl).toBe(MODELS_URL);
		});

		it("should derive the models URL from a custom baseUrl by stripping the trailing /v1", async () => {
			let capturedUrl: string | undefined;
			fetchSpy.mockImplementation(async (input) => {
				capturedUrl = toUrlString(input);
				return modelsListResponse([]);
			});
			const provider = new ClinePassProvider({
				apiKey: "test-key",
				baseUrl: CUSTOM_BASE_URL,
			});
			await provider.getCapabilities("cline-pass/glm-5.2");
			expect(capturedUrl).toBe(CUSTOM_MODELS_URL);
		});
	});
});
