import { describe, expect, it } from "bun:test";
import {
	CHAT_COMMANDS,
	COMMAND_ALIASES,
	generateHelpText,
	getCommandList,
	getCommandMeta,
	resolveCommandAlias,
} from "../../src/ui/chat-command-registry.js";

describe("chat-command-registry", () => {
	describe("CHAT_COMMANDS", () => {
		it("should include all expected commands", () => {
			const names = CHAT_COMMANDS.map((c) => c.name);
			expect(names).toContain("/help");
			expect(names).toContain("/clear");
			expect(names).toContain("/model");
			expect(names).toContain("/agent");
			expect(names).toContain("/login");
			expect(names).toContain("/logout");
			expect(names).toContain("/tools");
			expect(names).toContain("/mcp");
			expect(names).toContain("/memory");
			expect(names).toContain("/skill");
			expect(names).toContain("/plan");
			expect(names).toContain("/tasks");
			expect(names).toContain("/todo");
			expect(names).toContain("/review");
			expect(names).toContain("/exit");
		});

		it("should have a description for every command", () => {
			for (const cmd of CHAT_COMMANDS) {
				expect(cmd.description.length).toBeGreaterThan(0);
			}
		});

		it("should mark /skill as taking args", () => {
			const skill = getCommandMeta("/skill");
			expect(skill?.takesArgs).toBe(true);
		});

		it("should not mark other commands as taking args by default", () => {
			const clear = getCommandMeta("/clear");
			expect(clear?.takesArgs).toBeUndefined();
		});
	});

	describe("getCommandMeta", () => {
		it("should return metadata for a known command", () => {
			const meta = getCommandMeta("/help");
			expect(meta).toBeDefined();
			expect(meta?.name).toBe("/help");
		});

		it("should return undefined for an unknown command", () => {
			expect(getCommandMeta("/nonexistent")).toBeUndefined();
		});
	});

	describe("resolveCommandAlias", () => {
		it("should resolve /tasks to /plan", () => {
			expect(resolveCommandAlias("/tasks")).toBe("/plan");
		});

		it("should resolve /todo to /plan", () => {
			expect(resolveCommandAlias("/todo")).toBe("/plan");
		});

		it("should return the input for non-aliased commands", () => {
			expect(resolveCommandAlias("/clear")).toBe("/clear");
			expect(resolveCommandAlias("/help")).toBe("/help");
		});

		it("should return the input for unknown commands", () => {
			expect(resolveCommandAlias("/nonexistent")).toBe("/nonexistent");
		});

		it("should have all aliases in COMMAND_ALIASES map", () => {
			expect(COMMAND_ALIASES.get("/tasks")).toBe("/plan");
			expect(COMMAND_ALIASES.get("/todo")).toBe("/plan");
			expect(COMMAND_ALIASES.get("/clear")).toBeUndefined();
		});
	});

	describe("generateHelpText", () => {
		it("should generate help text with all commands", () => {
			const text = generateHelpText();
			expect(text).toContain("Available commands:");
			expect(text).toContain("/help");
			expect(text).toContain("/clear");
			expect(text).toContain("/model");
			expect(text).toContain("/exit");
			expect(text).toContain("/review");
		});

		it("should include /exit at the end", () => {
			const text = generateHelpText();
			const lines = text.split("\n");
			const lastLine = lines[lines.length - 1];
			expect(lastLine).toContain("/exit");
		});

		it("should not duplicate any command", () => {
			const text = generateHelpText();
			const lines = text.split("\n").filter((l) => l.trim().startsWith("/"));
			const names = lines.map((l) => l.trim().split(/\s+/)[0] ?? "");
			const unique = new Set(names);
			expect(unique.size).toBe(names.length);
		});
	});

	describe("getCommandList", () => {
		it("should return all commands as {name, description} objects", () => {
			const list = getCommandList();
			expect(list.length).toBe(CHAT_COMMANDS.length);
			for (const item of list) {
				expect(typeof item.name).toBe("string");
				expect(typeof item.description).toBe("string");
			}
		});

		it("should match the CHAT_COMMANDS data", () => {
			const list = getCommandList();
			expect(list[0]?.name).toBe("/help");
			expect(list[0]?.description).toBe("Show available commands");
		});
	});
});
