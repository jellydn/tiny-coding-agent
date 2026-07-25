import { describe, expect, it } from "bun:test";
import { isSensitiveKey, previewText, redactObject, redactSecret, redactUrl } from "../../src/observability/redact.js";

describe("redact", () => {
	describe("isSensitiveKey", () => {
		it("flags api key, authorization, token, secret keys", () => {
			expect(isSensitiveKey("apiKey")).toBe(true);
			expect(isSensitiveKey("API_KEY")).toBe(true);
			expect(isSensitiveKey("authorization")).toBe(true);
			expect(isSensitiveKey("x-auth-token")).toBe(true);
			expect(isSensitiveKey("password")).toBe(true);
			expect(isSensitiveKey("bearer")).toBe(true);
		});

		it("does not flag ordinary keys", () => {
			expect(isSensitiveKey("model")).toBe(false);
			expect(isSensitiveKey("content")).toBe(false);
			expect(isSensitiveKey("latencyMs")).toBe(false);
		});
	});

	describe("redactSecret", () => {
		it("masks long secrets keeping a short prefix", () => {
			expect(redactSecret("sk-1234567890abcdef")).toBe("sk-1...REDACTED");
		});
		it("fully masks short secrets", () => {
			expect(redactSecret("short")).toBe("****");
			expect(redactSecret(undefined)).toBeUndefined();
		});
	});

	describe("previewText", () => {
		it("truncates and collapses whitespace", () => {
			const result = previewText("hello\n\n   world", 100);
			expect(result).toBe("hello world");
		});
		it("adds ellipsis when over the limit", () => {
			const result = previewText("a".repeat(300), 50);
			expect(result?.endsWith("…")).toBe(true);
			expect(result?.length).toBe(51);
		});
		it("handles undefined", () => {
			expect(previewText(undefined)).toBeUndefined();
		});
	});

	describe("redactObject", () => {
		it("replaces sensitive values with [REDACTED]", () => {
			const input = { model: "gpt-4o", apiKey: "sk-secret", nested: { token: "abc" } };
			const out = redactObject(input) as Record<string, unknown>;
			expect(out.apiKey).toBe("[REDACTED]");
			expect(out.model).toBe("gpt-4o");
			expect((out.nested as Record<string, unknown>).token).toBe("[REDACTED]");
		});

		it("redacts arrays of objects", () => {
			const input = [{ name: "ok", password: "p" }];
			const out = redactObject(input) as Array<Record<string, unknown>>;
			expect(out[0]?.password).toBe("[REDACTED]");
			expect(out[0]?.name).toBe("ok");
		});

		it("does not mutate the input", () => {
			const input = { apiKey: "sk-secret" };
			redactObject(input);
			expect(input.apiKey).toBe("sk-secret");
		});
	});

	describe("redactUrl", () => {
		it("strips credentials and redacts sensitive query params", () => {
			const out = redactUrl("https://user:pass@host.com/path?api_key=secret&keep=1");
			expect(out).not.toContain("user:pass");
			expect(out).not.toContain("secret");
			expect(out).toContain("keep=1");
			expect(out).toContain("[REDACTED]");
		});
		it("returns a placeholder for invalid urls", () => {
			expect(redactUrl("not a url")).toBe("[invalid-url]");
		});
	});
});
