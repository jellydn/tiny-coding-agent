/**
 * Plan Converter — converts parsed plan grammar into BuildStep[] for the
 * build agent. Extracted from build-agent.ts to separate the plan-parsing
 * concern from the execution concern.
 *
 * Two shapes, picked automatically:
 * - Phase-form: each Phase -> one BuildStep with multiple actions (one per
 *   Step within the phase). Detected by the presence of a `## Phase ...`
 *   marker in the raw text.
 * - Flat-form (no phase headers, steps numbered 1, 2, 3, ... at top
 *   level): each Step -> its own BuildStep.
 */

import { type Step as GrammarStep, type Plan, parse as parsePlanGrammar } from "./plan-grammar.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuildStep {
	stepNumber: number;
	description: string;
	actions: BuildAction[];
	status?: "pending" | "completed" | "failed" | "skipped";
	changes?: Array<{
		type: "create" | "modify" | "delete";
		path: string;
		diff?: string;
	}>;
	confirmed?: boolean;
}

export interface BuildAction {
	type: "create" | "modify" | "delete" | "execute";
	path?: string;
	content?: string;
	oldContent?: string;
	description: string;
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

/**
 * Convert a Plan returned by `PlanGrammar.parse` into the build-agent's
 * `BuildStep[]` shape.
 *
 * Legacy quirk: build-agent previously parsed sub-bullet `- text` lines
 * under a numbered flat-form step as additional actions. The grammar
 * doesn't include this shape, so we re-scan the raw text for those sub-
 * bullets in flat-form mode to preserve backward compatibility.
 */
function planToBuildSteps(plan: Plan, rawText: string): BuildStep[] {
	if (plan.phases.length === 0) {
		return [];
	}

	const hasPhaseHeaders = /^\s*##\s*(?:Phase\s+)?\d+/m.test(rawText);

	if (!hasPhaseHeaders) {
		const flatPhase = plan.phases[0];
		if (flatPhase) {
			return buildFlatFormSteps(rawText, flatPhase.steps);
		}
	}

	return plan.phases.map((phase) => ({
		stepNumber: phase.number,
		description: phase.title,
		actions: phase.steps.map((step) => ({
			type: "execute" as const,
			description: step.text,
		})),
	}));
}

function buildFlatFormSteps(rawText: string, flatSteps: GrammarStep[]): BuildStep[] {
	const result: BuildStep[] = [];
	const lines = rawText.split("\n");
	// Index flat steps by (number, text) so the per-line lookup below is O(1)
	// instead of an O(M) Array.find inside the loop. Keying on the same pair
	// the original predicate used preserves the exact match semantics: a
	// grammar step with the same number but different text will NOT match, so
	// the description correctly falls back to the line text. The `\0` separator
	// is safe because `text` comes from `.trim()` of a non-greedy `.+?` regex
	// match that doesn't span lines — `\0` can't appear in any key.
	const stepByKey = new Map<string, GrammarStep>();
	for (const s of flatSteps) {
		const key = `${s.number}\0${s.text}`;
		if (!stepByKey.has(key)) stepByKey.set(key, s);
	}
	let currentBuild: BuildStep | null = null;

	for (const line of lines) {
		const stepMatch = line.match(/^\s*(\d+)\.\s+(.+?)\s*$/);
		if (stepMatch) {
			const n = parseInt(stepMatch[1] ?? "0", 10);
			const text = (stepMatch[2] ?? "").trim();
			const grammarStep = stepByKey.get(`${n}\0${text}`);
			currentBuild = {
				stepNumber: n,
				description: grammarStep?.text ?? text,
				actions: [{ type: "execute", description: text }],
			};
			result.push(currentBuild);
			continue;
		}

		const bulletMatch = line.match(/^\s*-\s+(.+?)\s*$/);
		if (bulletMatch && currentBuild) {
			const text = (bulletMatch[1] ?? "").trim();
			if (text && !text.startsWith("**")) {
				currentBuild.actions.push({ type: "execute", description: text });
			}
		}
	}

	return result;
}

/**
 * Parse a plan content string into BuildStep[].
 */
export function parsePlanToSteps(planContent: string): BuildStep[] {
	const plan = parsePlanGrammar(planContent);
	return planToBuildSteps(plan, planContent);
}
