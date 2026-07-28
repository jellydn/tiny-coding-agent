import { describe, expect, it } from "bun:test";
import { emptyHookRegistry } from "../../src/hooks/types.js";

describe("HookTypes", () => {
	describe("emptyHookRegistry", () => {
		it("should return a registry with all three events", () => {
			const registry = emptyHookRegistry();
			expect(registry).toHaveProperty("post-plan-generate");
			expect(registry).toHaveProperty("pre-build-execute");
			expect(registry).toHaveProperty("post-explore-complete");
		});

		it("should return empty arrays for all events", () => {
			const registry = emptyHookRegistry();
			expect(registry["post-plan-generate"]).toEqual([]);
			expect(registry["pre-build-execute"]).toEqual([]);
			expect(registry["post-explore-complete"]).toEqual([]);
		});

		it("should return a new object each call (not shared state)", () => {
			const a = emptyHookRegistry();
			const b = emptyHookRegistry();
			expect(a).not.toBe(b);
			a["post-plan-generate"].push({ name: "test", event: "post-plan-generate", command: "echo" });
			expect(b["post-plan-generate"]).toEqual([]);
		});
	});
});
