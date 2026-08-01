/**
 * skill-handler.ts — /skill command handler for tiny-agent chat UI.
 *
 * Extracted from useCommandHandler.ts (Round 8 Candidate #2) so skill
 * loading logic is independently testable.
 */

import type { Agent } from "../../core/agent.js";
import { MessageRole } from "../types/enums.js";

interface SkillHandlerDeps {
	agent?: Agent;
	onAddMessage: (role: MessageRole, content: string) => void;
}

/**
 * Handle the /skill command — list available skills or load a specific skill.
 */
export async function handleSkillCommand(args: string, deps: SkillHandlerDeps): Promise<void> {
	const { agent, onAddMessage } = deps;
	const skillName = args.trim();

	if (!skillName) {
		if (!agent) {
			onAddMessage(MessageRole.ASSISTANT, "Error: Agent not initialized. Cannot list skills.");
			return;
		}

		const skills = agent.getSkillRegistry();
		const skillList = Array.from(skills.values());

		if (skillList.length === 0) {
			onAddMessage(
				MessageRole.ASSISTANT,
				`No skills available.\n\nUse "tiny-agent skill init <name>" to create a new skill, or configure skillDirectories in your config.yaml.`
			);
		} else {
			const skillDescriptions = skillList.map((s) => `  • **${s.name}**: ${s.description}`).join("\n");
			onAddMessage(
				MessageRole.ASSISTANT,
				`Available skills:\n\n${skillDescriptions}\n\nType @skill-name to load a skill.`
			);
		}
		return;
	}

	if (!agent) {
		onAddMessage(MessageRole.ASSISTANT, "Error: Agent not initialized. Cannot load skills.");
		return;
	}

	const skillRegistry = agent.getSkillRegistry();

	if (!skillRegistry.has(skillName)) {
		const availableSkills = Array.from(skillRegistry.keys()).join(", ");
		onAddMessage(
			MessageRole.ASSISTANT,
			`Skill not found: ${skillName}\n\nAvailable skills: ${availableSkills || "none"}\n\nType @skill-name to load a skill.`
		);
		return;
	}

	try {
		const result = await agent.loadSkill(skillName);
		if (!result) {
			const availableSkills = Array.from(skillRegistry.keys()).join(", ");
			onAddMessage(
				MessageRole.ASSISTANT,
				`Skill not found: ${skillName}\n\nAvailable skills: ${availableSkills || "none"}`
			);
			return;
		}

		const { wrappedContent, allowedTools } = result;
		if (allowedTools) {
			onAddMessage(
				MessageRole.ASSISTANT,
				`Loaded skill: **${skillName}**\nRestricted tools to: ${allowedTools.join(", ")}\n\n${wrappedContent}`
			);
		} else {
			onAddMessage(MessageRole.ASSISTANT, `Loaded skill: **${skillName}**\nAll tools available.\n\n${wrappedContent}`);
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		onAddMessage(MessageRole.ASSISTANT, `Error loading skill: ${message}`);
	}
}
