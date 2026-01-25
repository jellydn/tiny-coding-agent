import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getEmbeddedSkillContent } from "../skills/builtin-registry.js";
import { parseSkillFrontmatter } from "../skills/parser.js";
import type { SkillMetadata } from "../skills/types.js";
import type { Tool, ToolResult } from "./types.js";

export function createSkillTool(
	skillRegistry: Map<string, SkillMetadata>,
	onSkillLoaded?: (allowedTools: string[] | undefined) => void
): Tool {
	return {
		name: "skill",
		description:
			"Load and read a skill's full content. Skills are reusable agent capabilities defined in SKILL.md files. Use this to get detailed instructions for a specific skill.",
		parameters: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "The name of the skill to load",
				},
			},
			required: ["name"],
		},
		async execute(args: Record<string, unknown>): Promise<ToolResult> {
			const skillName = args.name as string;

			if (!skillName) {
				return { success: false, error: "Skill name is required" };
			}

			const skillMetadata = skillRegistry.get(skillName);
			if (!skillMetadata) {
				const availableSkills = Array.from(skillRegistry.keys()).join(", ");
				return {
					success: false,
					error: `Skill not found: ${skillName}. Available skills: ${availableSkills || "none"}`,
				};
			}

			try {
				// Handle built-in skills (embedded content)
				let content: string;
				let baseDir = ".";

				if (skillMetadata.location.startsWith("builtin://")) {
					const embeddedContent = getEmbeddedSkillContent(skillName);
					if (!embeddedContent) {
						return { success: false, error: `Built-in skill content not found: ${skillName}` };
					}
					content = embeddedContent;
				} else {
					// File-based skill
					content = await fs.readFile(skillMetadata.location, "utf-8");
					baseDir = path.dirname(skillMetadata.location);
				}

				let allowedTools: string[] | undefined;
				try {
					const parsed = parseSkillFrontmatter(content);
					allowedTools = parsed.frontmatter.allowedTools;
				} catch {
					console.warn(`[WARN] Could not parse frontmatter for skill: ${skillName}`);
				}

				if (onSkillLoaded) {
					onSkillLoaded(allowedTools);
				}

				// Escape XML special characters to prevent injection attacks
				const escapedContent = content
					.replace(/&/g, "&amp;")
					.replace(/</g, "&lt;")
					.replace(/>/g, "&gt;")
					.replace(/"/g, "&quot;")
					.replace(/'/g, "&apos;");

				const wrappedContent = `<loaded_skill name="${skillName}" base_dir="${baseDir}">\n${escapedContent}\n</loaded_skill>`;
				return { success: true, output: wrappedContent };
			} catch (err) {
				const error = err as NodeJS.ErrnoException;
				if (error.code === "ENOENT") {
					return { success: false, error: `Skill file not found: ${skillMetadata.location}` };
				}
				return { success: false, error: `Failed to read skill: ${error.message}` };
			}
		},
	};
}
