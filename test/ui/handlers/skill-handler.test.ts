import { describe, expect, it, vi } from "bun:test";
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
		};

		await handleSkillCommand("", { agent: mockAgent as any, onAddMessage });

		expect(onAddMessage).toHaveBeenCalledWith(MessageRole.ASSISTANT, expect.stringContaining("Available skills"));
	});

	it("should show error when skill not found", async () => {
		const onAddMessage = vi.fn();
		const mockAgent = {
			getSkillRegistry: () => new Map(),
		};

		await handleSkillCommand("nonexistent", { agent: mockAgent as any, onAddMessage });

		expect(onAddMessage).toHaveBeenCalledWith(MessageRole.ASSISTANT, expect.stringContaining("Skill not found"));
	});

	it("should load skill when found", async () => {
		const onAddMessage = vi.fn();
		const mockAgent = {
			getSkillRegistry: () => new Map([["test-skill", { name: "test-skill", description: "A test skill" }]]),
			loadSkill: async () => ({ wrappedContent: "Skill content", allowedTools: undefined }),
		};

		await handleSkillCommand("test-skill", { agent: mockAgent as any, onAddMessage });

		expect(onAddMessage).toHaveBeenCalledWith(MessageRole.ASSISTANT, expect.stringContaining("Loaded skill"));
	});
});
