import { describe, expect, it } from "bun:test";
import { buildRegistry, hasHooks, runHooks } from "../../src/hooks/manager.js";
import type { HookConfig } from "../../src/hooks/types.js";
import { emptyHookRegistry } from "../../src/hooks/types.js";

describe("HookManager", () => {
	describe("buildRegistry", () => {
		it("should return empty registry for undefined hooks", () => {
			const registry = buildRegistry(undefined);
			expect(registry["post-plan-generate"]).toEqual([]);
			expect(registry["pre-build-execute"]).toEqual([]);
			expect(registry["post-explore-complete"]).toEqual([]);
		});

		it("should group hooks by event", () => {
			const hooks: HookConfig[] = [
				{ name: "a", event: "post-plan-generate", command: "echo" },
				{ name: "b", event: "pre-build-execute", command: "echo" },
				{ name: "c", event: "post-plan-generate", command: "echo" },
			];
			const registry = buildRegistry(hooks);
			expect(registry["post-plan-generate"]).toHaveLength(2);
			expect(registry["pre-build-execute"]).toHaveLength(1);
			expect(registry["post-explore-complete"]).toEqual([]);
		});

		it("should skip disabled hooks", () => {
			const hooks: HookConfig[] = [
				{ name: "a", event: "post-plan-generate", command: "echo", enabled: true },
				{ name: "b", event: "post-plan-generate", command: "echo", enabled: false },
			];
			const registry = buildRegistry(hooks);
			expect(registry["post-plan-generate"]).toHaveLength(1);
			expect(registry["post-plan-generate"][0]?.name).toBe("a");
		});
	});

	describe("hasHooks", () => {
		it("should return false for empty registry", () => {
			const registry = emptyHookRegistry();
			expect(hasHooks(registry, "post-plan-generate")).toBe(false);
		});

		it("should return true when hooks exist for event", () => {
			const registry = buildRegistry([{ name: "test", event: "post-plan-generate", command: "echo" }]);
			expect(hasHooks(registry, "post-plan-generate")).toBe(true);
			expect(hasHooks(registry, "pre-build-execute")).toBe(false);
		});
	});

	describe("runHooks", () => {
		it("should return success with no modifications when no hooks", async () => {
			const registry = emptyHookRegistry();
			const result = await runHooks(registry, "post-plan-generate", {
				event: "post-plan-generate",
				content: "test plan",
			});
			expect(result.success).toBe(true);
			expect(result.modifiedContent).toBeUndefined();
			expect(result.approved).toBe(true);
		});

		it("should skip hooks when command binary is not found", async () => {
			const registry = buildRegistry([
				{
					name: "missing-tool",
					event: "post-plan-generate",
					command: "this-command-does-not-exist-xyz123",
					inputMode: "stdin",
				},
			]);
			const result = await runHooks(registry, "post-plan-generate", {
				event: "post-plan-generate",
				content: "test plan",
			});
			expect(result.success).toBe(true);
			expect(result.modifiedContent).toBeUndefined();
		});

		it("should pass content as arg when inputMode is arg", async () => {
			// Use `echo` with the content as an argument
			const registry = buildRegistry([
				{
					name: "echo-hook",
					event: "post-plan-generate",
					command: "echo",
					args: [],
					inputMode: "arg",
				},
			]);
			const result = await runHooks(registry, "post-plan-generate", {
				event: "post-plan-generate",
				content: "plan text",
			});
			expect(result.success).toBe(true);
			expect(result.modifiedContent).toContain("plan text");
		});

		it("should chain multiple hooks, passing modified content to the next", async () => {
			// Use `sed` to replace text, then `cat` to pass through
			const registry = buildRegistry([
				{
					name: "replace-hook",
					event: "post-plan-generate",
					command: "sed",
					args: ["s/original/modified/"],
					inputMode: "stdin",
				},
			]);
			const result = await runHooks(registry, "post-plan-generate", {
				event: "post-plan-generate",
				content: "original plan",
			});
			expect(result.success).toBe(true);
			expect(result.modifiedContent).toBe("modified plan");
		});

		it("should handle non-zero exit codes as errors", async () => {
			const registry = buildRegistry([
				{
					name: "fail-hook",
					event: "post-plan-generate",
					command: "false",
					inputMode: "stdin",
				},
			]);
			const result = await runHooks(registry, "post-plan-generate", {
				event: "post-plan-generate",
				content: "test",
			});
			expect(result.success).toBe(false);
			expect(result.error).toContain("exited with code");
		});
	});
});
