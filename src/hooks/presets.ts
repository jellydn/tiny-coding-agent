/**
 * Built-in hook presets — ready-to-install hook configurations for popular
 * human-in-the-loop tools.
 *
 * Currently includes:
 * - plannotator: Visual plan review in the browser (https://github.com/backnotprop/plannotator)
 *
 * @see src/hooks/types.ts for the HookPreset interface
 */

import type { HookPreset } from "./types.js";

/** Plannotator preset — visual plan review in the browser. */
export const PLANNOTATOR_PRESET: HookPreset = {
	id: "plannotator",
	name: "Plannotator",
	description:
		"Visual plan review in the browser. Opens the plan in a local web UI where you can annotate, edit, approve, or reject before execution. Requires the `plannotator` binary (npx plannotator or install from npm).",
	checkCommand: "plannotator",
	installInstructions:
		"Install plannotator:\n  npm install -g plannotator\n  or use npx plannotator\n\nFor more info: https://github.com/backnotprop/plannotator",
	hooks: [
		{
			name: "plannotator-review-plan",
			event: "post-plan-generate",
			command: "plannotator",
			args: ["--review"],
			inputMode: "stdin",
			timeoutMs: 0, // no timeout — wait for human review
			enabled: true,
			applyModifications: true,
		},
		{
			name: "plannotator-review-build",
			event: "pre-build-execute",
			command: "plannotator",
			args: ["--review"],
			inputMode: "stdin",
			timeoutMs: 0,
			enabled: false, // off by default — user enables if they want double review
			applyModifications: true,
		},
	],
};

/** All available built-in presets. */
export const BUILTIN_PRESETS: HookPreset[] = [PLANNOTATOR_PRESET];

/** Find a preset by ID. */
export function findPreset(id: string): HookPreset | undefined {
	return BUILTIN_PRESETS.find((p) => p.id === id);
}

/** List all preset IDs. */
export function listPresetIds(): string[] {
	return BUILTIN_PRESETS.map((p) => p.id);
}
