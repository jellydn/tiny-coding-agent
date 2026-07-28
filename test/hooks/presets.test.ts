import { describe, expect, it } from "bun:test";
import { BUILTIN_PRESETS, findPreset, listPresetIds, PLANNOTATOR_PRESET } from "../../src/hooks/presets.js";

describe("HookPresets", () => {
	describe("PLANNOTATOR_PRESET", () => {
		it("should have the correct id and name", () => {
			expect(PLANNOTATOR_PRESET.id).toBe("plannotator");
			expect(PLANNOTATOR_PRESET.name).toBe("Plannotator");
		});

		it("should have a description", () => {
			expect(PLANNOTATOR_PRESET.description).toBeTruthy();
			expect(PLANNOTATOR_PRESET.description.length).toBeGreaterThan(20);
		});

		it("should have at least one hook", () => {
			expect(PLANNOTATOR_PRESET.hooks.length).toBeGreaterThan(0);
		});

		it("should have a post-plan-generate hook enabled by default", () => {
			const planHook = PLANNOTATOR_PRESET.hooks.find((h) => h.event === "post-plan-generate");
			expect(planHook).toBeDefined();
			expect(planHook?.enabled).toBe(true);
			expect(planHook?.command).toBe("plannotator");
		});

		it("should have a pre-build-execute hook disabled by default", () => {
			const buildHook = PLANNOTATOR_PRESET.hooks.find((h) => h.event === "pre-build-execute");
			expect(buildHook).toBeDefined();
			expect(buildHook?.enabled).toBe(false);
		});

		it("should use stdin input mode", () => {
			for (const hook of PLANNOTATOR_PRESET.hooks) {
				expect(hook.inputMode).toBe("stdin");
			}
		});

		it("should have no timeout (wait for human review)", () => {
			for (const hook of PLANNOTATOR_PRESET.hooks) {
				expect(hook.timeoutMs).toBe(0);
			}
		});

		it("should have install instructions", () => {
			expect(PLANNOTATOR_PRESET.installInstructions).toBeTruthy();
			expect(PLANNOTATOR_PRESET.installInstructions).toContain("plannotator");
		});

		it("should have checkCommand set", () => {
			expect(PLANNOTATOR_PRESET.checkCommand).toBe("plannotator");
		});
	});

	describe("BUILTIN_PRESETS", () => {
		it("should include plannotator", () => {
			expect(BUILTIN_PRESETS).toContain(PLANNOTATOR_PRESET);
		});

		it("should have at least one preset", () => {
			expect(BUILTIN_PRESETS.length).toBeGreaterThan(0);
		});
	});

	describe("findPreset", () => {
		it("should find plannotator by id", () => {
			expect(findPreset("plannotator")).toBe(PLANNOTATOR_PRESET);
		});

		it("should return undefined for unknown preset id", () => {
			expect(findPreset("nonexistent")).toBeUndefined();
		});
	});

	describe("listPresetIds", () => {
		it("should include plannotator", () => {
			expect(listPresetIds()).toContain("plannotator");
		});

		it("should return at least one id", () => {
			expect(listPresetIds().length).toBeGreaterThan(0);
		});
	});
});
