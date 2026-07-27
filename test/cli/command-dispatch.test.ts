import { describe, expect, it } from "bun:test";
import {
	dispatchPreConfig,
	isPostConfigCommand,
	isPreConfigCommand,
	KNOWN_COMMANDS,
	planRoute,
	resolveAlias,
} from "../../src/cli/command-dispatch.js";
import type { CliOptions } from "../../src/cli/shared.js";

const mockOptions: CliOptions = { model: "gpt-4o", verbose: false };

// ─── isPreConfigCommand ──────────────────────────────────────────────────

describe("isPreConfigCommand", () => {
	it("returns true for login", () => {
		expect(isPreConfigCommand("login")).toBe(true);
	});

	it("returns true for logout", () => {
		expect(isPreConfigCommand("logout")).toBe(true);
	});

	it("returns false for chat", () => {
		expect(isPreConfigCommand("chat")).toBe(false);
	});

	it("returns false for unknown commands", () => {
		expect(isPreConfigCommand("foobar")).toBe(false);
	});
});

// ─── isPostConfigCommand ─────────────────────────────────────────────────

describe("isPostConfigCommand", () => {
	it("returns true for all standard commands", () => {
		for (const cmd of [
			"chat",
			"run",
			"config",
			"status",
			"memory",
			"skill",
			"mcp",
			"state",
			"trace",
			"plan",
			"build",
			"explore",
			"run-plan-build",
			"run-all",
		]) {
			expect(isPostConfigCommand(cmd)).toBe(true);
		}
	});

	it("returns true for aliases", () => {
		expect(isPostConfigCommand("tasks")).toBe(true);
		expect(isPostConfigCommand("todo")).toBe(true);
	});

	it("returns false for pre-config commands", () => {
		expect(isPostConfigCommand("login")).toBe(false);
		expect(isPostConfigCommand("logout")).toBe(false);
	});

	it("returns false for unknown commands", () => {
		expect(isPostConfigCommand("foobar")).toBe(false);
	});
});

// ─── resolveAlias ────────────────────────────────────────────────────────

describe("resolveAlias", () => {
	it("resolves tasks → plan tasks", () => {
		const result = resolveAlias("tasks", []);
		expect(result).toEqual({ command: "plan", args: ["tasks"] });
	});

	it("resolves todo → plan todo", () => {
		const result = resolveAlias("todo", []);
		expect(result).toEqual({ command: "plan", args: ["todo"] });
	});

	it("returns null for non-alias commands", () => {
		expect(resolveAlias("chat", [])).toBeNull();
		expect(resolveAlias("run", ["hello"])).toBeNull();
		expect(resolveAlias("config", ["open"])).toBeNull();
	});

	it("returns null for unknown commands", () => {
		expect(resolveAlias("foobar", [])).toBeNull();
	});
});

// ─── planRoute ───────────────────────────────────────────────────────────

describe("planRoute", () => {
	it("routes to plan handler for show", () => {
		expect(planRoute("show")).toBe("plan");
	});

	it("routes to plan handler for tasks", () => {
		expect(planRoute("tasks")).toBe("plan");
	});

	it("routes to plan handler for todo", () => {
		expect(planRoute("todo")).toBe("plan");
	});

	it("routes to agent handler when no args", () => {
		expect(planRoute(undefined)).toBe("agent");
	});

	it("routes to agent handler for non-plan subcommands", () => {
		expect(planRoute("create")).toBe("agent");
		expect(planRoute("delete")).toBe("agent");
	});
});

// ─── KNOWN_COMMANDS ──────────────────────────────────────────────────────

describe("KNOWN_COMMANDS", () => {
	it("includes all standard commands", () => {
		expect(KNOWN_COMMANDS).toContain("chat");
		expect(KNOWN_COMMANDS).toContain("run <prompt>");
		expect(KNOWN_COMMANDS).toContain("login");
		expect(KNOWN_COMMANDS).toContain("logout");
		expect(KNOWN_COMMANDS).toContain("config");
		expect(KNOWN_COMMANDS).toContain("status");
	});

	it("includes aliases", () => {
		expect(KNOWN_COMMANDS).toContain("tasks");
		expect(KNOWN_COMMANDS).toContain("todo");
	});
});

// ─── dispatchPreConfig ───────────────────────────────────────────────────

describe("dispatchPreConfig", () => {
	it("returns false for non-pre-config commands", async () => {
		const result = await dispatchPreConfig("chat", [], mockOptions);
		expect(result).toBe(false);
	});

	it("returns false for unknown commands", async () => {
		const result = await dispatchPreConfig("foobar", [], mockOptions);
		expect(result).toBe(false);
	});

	// Note: login/logout handlers call process.exit, so we test the return
	// value of dispatchPreConfig for non-matching commands rather than
	// triggering the full login flow. The dispatch routing itself is verified
	// by isPreConfigCommand tests above.
});
