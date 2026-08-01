import { describe, expect, it, vi } from "bun:test";
import type { Agent } from "../../../src/core/agent.js";
import { handleSkillCommand } from "../../../src/ui/handlers/skill-handler.js";
import { MessageRole } from "../../../src/ui/types/enums.js";

describe("handleSkillCommand", () => {
	it("should show error when agent not initialized", async () => {
		const onAddMessage = vi.fn();
		await handleSkillCommand("list", { agent: undefined, onAddMessage });

		expect(onAddMessage).toHaveBeenCalledWith(MessageRole.ASSISTANT, expect.stringContaining("Agent not initialized"));
	});

	it("should list skills when no skill name provided", async () => {
		const onAddMessage = vi.fn();
		const mockAgent = {
			getSkillRegistry: () => new Map([["test-skill", { name: "test-skill", description: "A test skill" }]]),
		} as unknown as Agent;

		await handleSkillCommand("", { agent: mockAgent, onAddMessage });

		expect(onAddMessage).toHaveBeenCalledWith(MessageRole.ASSISTANT, expect.stringContaining("Available skills"));
	});

	it("should show error when skill not found", async () => {
		const onAddMessage = vi.fn();
		const mockAgent = {
			getSkillRegistry: () => new Map(),
		} as unknown as Agent;

		await handleSkillCommand("nonexistent", { agent: mockAgent, onAddMessage });

		expect(onAddMessage).toHaveBeenCalledWith(MessageRole.ASSISTANT, expect.stringContaining("Skill not found"));
	});

	it("should load skill when found", async () => {
		const onAddMessage = vi.fn();
		const mockAgent = {
			getSkillRegistry: () => new Map([["test-skill", { name: "test-skill", description: "A test skill" }]]),
			loadSkill: async () => ({ wrappedContent: "Skill content", allowedTools: undefined }),
		} as unknown as Agent;

		await handleSkillCommand("test-skill", { agent: mockAgent, onAddMessage });

		expect(onAddMessage).toHaveBeenCalledWith(MessageRole.ASSISTANT, expect.stringContaining("Loaded skill"));
	});
});
