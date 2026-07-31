/**
 * PlanGrammar — single source of truth for the canonical plan format.
 *
 * Why this module exists: plan-agent emits plans as markdown; build-agent and
 * the handlePlan CLI / tasks viewer both parse plans. Without a shared grammar,
 * two readers diverge silently. This module owns: Plan/Phase/Step types,
 * `serialize` (canonical markdown → AST-via-string), `parse` (forgiving
 * markdown → AST), `validate` (semantic checks), and `exampleOutput` (a
 * prompt-grounding fixture).
 *
 * Consumers reference one of three entry points:
 * - `serialize(plan)` — emit canonical markdown.
 * - `parse(text)` — extract a Plan from markdown (LLM-resilient).
 * - `validate(plan)` — semantic checks (sequential phase numbers, dependencies
 *   resolve to earlier phases).
 *
 * Implementation is split across:
 * - `plan-types.ts` — shared types (Step, Phase, Plan, ValidationResult)
 * - `plan-parser.ts` — parse() with forgiving markdown → AST
 * - `plan-validator.ts` — validate() with semantic checks
 * - `plan-grammar.ts` (this file) — serialize(), exampleOutput(), re-exports
 */

// Re-export parse from plan-parser
export { parse } from "./plan-parser.js";
// Re-export types from plan-types
export type { Phase, Plan, Step, ValidationResult } from "./plan-types.js";

// Re-export validate from plan-validator
export { validate } from "./plan-validator.js";

// ---------------------------------------------------------------------------
// Serialize
// ---------------------------------------------------------------------------

import type { Plan } from "./plan-types.js";

/**
 * Serialize a Plan into canonical markdown.
 *
 * The output is the canonical form: a future `parse(serialize(plan))`
 * returns a semantically equivalent Plan (deep-equal modulo the optional
 * fields' presence).
 */
export function serialize(plan: Plan): string {
	const lines: string[] = [];
	lines.push(`# Implementation Plan: ${plan.title}`);
	lines.push("");

	if (plan.overview && plan.overview.trim().length > 0) {
		lines.push("## Overview");
		lines.push(plan.overview.trim());
		lines.push("");
	}

	for (const phase of plan.phases) {
		lines.push(`## Phase ${phase.number}: ${phase.title}`);
		lines.push("");
		lines.push(
			`**Dependencies:** ${phase.dependencies.length === 0 ? "None" : phase.dependencies.map((d) => `Phase ${d}`).join(", ")}`
		);
		lines.push("");

		if (phase.successCriteria.length > 0) {
			lines.push("**Success Criteria:**");
			for (const c of phase.successCriteria) {
				lines.push(`- [ ] ${c}`);
			}
			lines.push("");
		}

		if (phase.steps.length > 0) {
			lines.push("### Steps:");
			for (const step of phase.steps) {
				lines.push(`${step.number}. ${step.text}`);
			}
			lines.push("");
		}
	}

	if (plan.technicalConsiderations && plan.technicalConsiderations.length > 0) {
		lines.push("## Technical Considerations");
		for (const c of plan.technicalConsiderations) {
			lines.push(`- ${c}`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Example output
// ---------------------------------------------------------------------------

/**
 * Canonical example plan, used as prompt-grounding by plan-agent.
 *
 * plan-agent embeds this in PLAN_SYSTEM_PROMPT so the LLM sees a concrete
 * instance of the format it should emit before answering.
 */
export function exampleOutput(): string {
	return serialize({
		title: "Sample Feature",
		overview: "Implement the feature end-to-end with tests.",
		phases: [
			{
				number: 1,
				title: "Scaffolding",
				dependencies: [],
				successCriteria: ["Repository layout is in place", "Base types are exported"],
				steps: [
					{ number: 1, text: "Create directory layout" },
					{ number: 2, text: "Add base type definitions" },
				],
			},
			{
				number: 2,
				title: "Implementation",
				dependencies: [1],
				successCriteria: ["Core logic works against sample inputs"],
				steps: [
					{ number: 1, text: "Implement parser" },
					{ number: 2, text: "Wire into the public API" },
				],
			},
		],
		technicalConsiderations: ["Use Bun's test runner for verification"],
	});
}
