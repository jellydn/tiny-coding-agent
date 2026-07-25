import { describe, expect, it } from "bun:test";
import { exampleOutput, type Plan, parse, serialize, validate } from "../../src/agents/plan-grammar.js";

describe("serialize/parse round-trip", () => {
	it("round-trips a canonical plan with all fields", () => {
		const original: Plan = {
			title: "Build a CLI",
			overview: "Provide a CLI for the project.",
			phases: [
				{
					number: 1,
					title: "Bootstrap",
					dependencies: [],
					successCriteria: ["CLI imports work"],
					steps: [
						{ number: 1, text: "Add entry script" },
						{ number: 2, text: "Wire up command parser" },
					],
				},
				{
					number: 2,
					title: "Ship",
					dependencies: [1],
					successCriteria: ["End-to-end test passes"],
					steps: [{ number: 1, text: "Polish docs" }],
				},
			],
			technicalConsiderations: ["Use Biome for lint"],
		};
		const text = serialize(original);
		const reparsed = parse(text);
		expect(reparsed).toEqual(original);
	});

	it("round-trips a minimal plan with no optional fields", () => {
		const minimal: Plan = {
			title: "Tiny",
			phases: [{ number: 1, title: "Only phase", dependencies: [], successCriteria: [], steps: [] }],
		};
		expect(parse(serialize(minimal))).toEqual(minimal);
	});

	it("round-trips exampleOutput", () => {
		const text = exampleOutput();
		const reparsed = parse(text);
		expect(reparsed.title).toBe("Sample Feature");
		expect(reparsed.phases.length).toBe(2);
		expect(reparsed.phases[0]?.number).toBe(1);
		expect(reparsed.phases[1]?.dependencies).toEqual([1]);
		expect(reparsed.technicalConsiderations?.length).toBeGreaterThan(0);
	});
});

describe("parse", () => {
	it("captures title from # header", () => {
		const plan = parse("# Hello World\n");
		expect(plan.title).toBe("Hello World");
	});

	it("captures title from '# Implementation Plan: Title'", () => {
		const plan = parse("# Implementation Plan: Real Plan\n");
		expect(plan.title).toBe("Real Plan");
	});

	it("captures phases with steps", () => {
		const text = `## Phase 1: First\n1. Do thing\n2. Do more\n\n## Phase 2: Second\n1. Continue`;
		const plan = parse(text);
		expect(plan.phases.length).toBe(2);
		expect(plan.phases[0]?.title).toBe("First");
		expect(plan.phases[0]?.steps.length).toBe(2);
		expect(plan.phases[1]?.steps.length).toBe(1);
	});

	it("accepts phase headers without titles", () => {
		const text = `## Phase 1\n1. Do thing\n\n## Phase 2\n1. Continue`;
		const plan = parse(text);
		expect(plan.phases.length).toBe(2);
		expect(plan.phases[0]?.steps.length).toBe(1);
	});

	it("captures dependencies", () => {
		const text = `## Phase 1: A\n\n**Dependencies:** None\n\n## Phase 2: B\n\n**Dependencies:** Phase 1\n`;
		const plan = parse(text);
		expect(plan.phases[0]?.dependencies).toEqual([]);
		expect(plan.phases[1]?.dependencies).toEqual([1]);
	});

	it("captures multi-dependency like 'Phase 1, Phase 3'", () => {
		const text = `## Phase 1\n\n## Phase 2\n\n## Phase 3\n\n## Phase 4\n\n**Dependencies:** Phase 1, Phase 3\n`;
		const plan = parse(text);
		expect(plan.phases[3]?.dependencies).toEqual([1, 3]);
	});

	it("captures success criteria without a deps line preceding", () => {
		const text = `## Phase 1\n**Success Criteria:**\n- [ ] Tests pass\n- [ ] Lint clean\n`;
		const plan = parse(text);
		expect(plan.phases[0]?.successCriteria).toEqual(["Tests pass", "Lint clean"]);
	});

	it("captures success criteria with a deps line preceding", () => {
		const text = `## Phase 1\n\n**Dependencies:** None\n\n**Success Criteria:**\n- [ ] Tests pass\n`;
		const plan = parse(text);
		expect(plan.phases[0]?.successCriteria).toEqual(["Tests pass"]);
	});

	it("captures flat-form into a synthetic single phase", () => {
		const text = `1. First\n2. Second\n3. Third`;
		const plan = parse(text);
		expect(plan.phases.length).toBe(1);
		expect(plan.phases[0]?.steps.length).toBe(3);
		expect(plan.phases[0]?.steps.map((s) => s.number)).toEqual([1, 2, 3]);
		expect(plan.phases[0]?.steps.map((s) => s.text)).toEqual(["First", "Second", "Third"]);
	});

	it("captures technical considerations", () => {
		const text = `## Technical Considerations\n- Use Bun\n- Pin Node 20\n`;
		const plan = parse(text);
		expect(plan.technicalConsiderations).toEqual(["Use Bun", "Pin Node 20"]);
	});

	it("captures overview text", () => {
		const text = `# Plan\n\n## Overview\nA brief summary\nspanning two lines.\n\n## Phase 1\n`;
		const plan = parse(text);
		expect(plan.overview).toBe("A brief summary\nspanning two lines.");
	});

	it("captures multi-paragraph overview", () => {
		const text = `# Plan\n\n## Overview\nPara one.\n\nPara two with more detail.\n\n## Phase 1\n`;
		const plan = parse(text);
		expect(plan.overview).toBe("Para one.\n\nPara two with more detail.");
	});

	it("returns empty plan for empty input", () => {
		const plan = parse("");
		expect(plan.title).toBe("Untitled");
		expect(plan.phases.length).toBe(0);
	});
});

describe("validate", () => {
	it("flags empty title", () => {
		const plan: Plan = { title: "  ", phases: [] };
		const result = validate(plan);
		expect(result.valid).toBe(false);
		expect(result.errors).toContain("plan title is empty");
	});

	it("flags zero-phase plan", () => {
		const plan: Plan = { title: "Empty", phases: [] };
		const result = validate(plan);
		expect(result.valid).toBe(false);
		expect(result.errors).toContain("plan has zero phases");
	});

	it("flags non-sequential phase numbers", () => {
		const plan: Plan = {
			title: "Bad",
			phases: [
				{ number: 1, title: "A", dependencies: [], successCriteria: [], steps: [] },
				{ number: 3, title: "B", dependencies: [], successCriteria: [], steps: [] },
			],
		};
		const result = validate(plan);
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toMatch(/out of order/);
	});

	it("flags forward dependency", () => {
		const plan: Plan = {
			title: "Bad",
			phases: [
				{ number: 1, title: "A", dependencies: [2], successCriteria: [], steps: [] },
				{ number: 2, title: "B", dependencies: [], successCriteria: [], steps: [] },
			],
		};
		const result = validate(plan);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => /forward dependency on phase 2/.test(e))).toBe(true);
	});

	it("flags self-dependency distinctly from forward", () => {
		const plan: Plan = {
			title: "Bad",
			phases: [{ number: 1, title: "A", dependencies: [1], successCriteria: [], steps: [] }],
		};
		const result = validate(plan);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => /self-dependency/.test(e))).toBe(true);
	});

	it("flags missing dependency", () => {
		const plan: Plan = {
			title: "Bad",
			phases: [{ number: 1, title: "A", dependencies: [5], successCriteria: [], steps: [] }],
		};
		const result = validate(plan);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => /missing phase 5/.test(e))).toBe(true);
	});

	it("accepts a canonical plan", () => {
		const canonical = parse(exampleOutput());
		const result = validate(canonical);
		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);
	});

	it("flags empty phase titles (regression: permissive parser accepts '## Phase N' alone)", () => {
		const text = `## Phase 1\n1. Do thing`;
		const plan = parse(text);
		expect(plan.phases[0]?.title).toBe("");
		const result = validate(plan);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => /phase 1 has empty title/.test(e))).toBe(true);
	});
});
