/**
 * Plan Validator — semantic checks for Plan structure.
 *
 * Validates:
 * - Title is non-empty
 * - Phase numbers are sequential starting at 1
 * - All phase dependencies refer to earlier phases
 * - Self-dependency and forward-dependency are reported distinctly
 * - All phase dependencies target a phase that exists within the plan
 */

import type { Plan, ValidationResult } from "./plan-types.js";

/**
 * Validate a Plan's semantic structure.
 *
 * Checks:
 * - Title is non-empty.
 * - Phase numbers are sequential starting at 1.
 * - All phase dependencies refer to earlier phases:
 *   self-dependency and forward-dependency are reported distinctly so a single
 *   bad dependency produces one clear error, not two.
 * - All phase dependencies target a phase that exists within the plan.
 */
export function validate(plan: Plan): ValidationResult {
	const errors: string[] = [];

	if (!plan.title || !plan.title.trim()) {
		errors.push("plan title is empty");
	}
	if (plan.phases.length === 0) {
		errors.push("plan has zero phases");
	}
	for (let i = 0; i < plan.phases.length; i++) {
		const phase = plan.phases[i];
		if (!phase) continue;
		const expected = i + 1;
		if (phase.number !== expected) {
			errors.push(`phase ${phase.number ?? "?"} is out of order; expected ${expected}`);
		}
		if (!phase.title || !phase.title.trim()) {
			errors.push(`phase ${phase.number} has empty title`);
		}
		for (const dep of phase.dependencies) {
			if (dep < 1) {
				errors.push(`phase ${phase.number} depends on non-positive phase ${dep}`);
				continue;
			}
			if (dep > plan.phases.length) {
				errors.push(`phase ${phase.number} depends on missing phase ${dep}`);
				continue;
			}
			if (dep === phase.number) {
				errors.push(`phase ${phase.number} has self-dependency`);
				continue;
			}
			if (dep > phase.number) {
				errors.push(`phase ${phase.number} has forward dependency on phase ${dep}`);
			}
		}
	}

	return { valid: errors.length === 0, errors };
}
