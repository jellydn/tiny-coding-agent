import { describe, expect, it } from "bun:test";
import { generateSkillsPrompt } from "../../src/skills/prompt.js";
import type { SkillMetadata } from "../../src/skills/types.js";

describe("generateSkillsPrompt", () => {
	it("should return empty string for empty skills array", () => {
		const result = generateSkillsPrompt([]);
		expect(result).toBe("");
	});

	it("should generate XML for single skill", () => {
		const skills: SkillMetadata[] = [{ name: "test-skill", description: "A test skill", location: "/path/to/skill" }];
		const result = generateSkillsPrompt(skills);
		expect(result).toContain("<available_skills>");
		expect(result).toContain("<skill><name>test-skill</name><description>A test skill</description><location>/path/to/skill</location></skill>");
		expect(result).toContain("</available_skills>");
		expect(result).toContain("call the 'skill' tool");
	});

	it("should generate XML for multiple skills", () => {
		const skills: SkillMetadata[] = [
			{ name: "skill-one", description: "First skill", location: "/path/one" },
			{ name: "skill-two", description: "Second skill", location: "/path/two" },
			{ name: "skill-three", description: "Third skill", location: "/path/three" },
		];
		const result = generateSkillsPrompt(skills);
		expect(result).toContain("<available_skills>");
		expect(result).toContain("<skill><name>skill-one</name><description>First skill</description><location>/path/one</location></skill>");
		expect(result).toContain("<skill><name>skill-two</name><description>Second skill</description><location>/path/two</location></skill>");
		expect(result).toContain("<skill><name>skill-three</name><description>Third skill</description><location>/path/three</location></skill>");
		expect(result).toContain("</available_skills>");
	});

	it("should escape special characters in skill metadata (XML injection protection)", () => {
		const skills: SkillMetadata[] = [
			{
				name: "my-skill",
				description: "A skill with <brackets> & ampersands",
				location: "/path/skill",
			},
		];
		const result = generateSkillsPrompt(skills);
		// XML special characters should be escaped to prevent injection
		expect(result).toContain("<skill><name>my-skill</name><description>A skill with &lt;brackets&gt; &amp; ampersands</description><location>/path/skill</location></skill>");
	});

	it("should handle skills with hyphens in name", () => {
		const skills: SkillMetadata[] = [
			{ name: "my-custom-skill-123", description: "Test description", location: "/path" },
		];
		const result = generateSkillsPrompt(skills);
		expect(result).toContain("<name>my-custom-skill-123</name>");
	});

	it("should include usage instructions for loading skills", () => {
		const skills: SkillMetadata[] = [{ name: "test-skill", description: "A test skill", location: "/path/to/skill" }];
		const result = generateSkillsPrompt(skills);
		expect(result).toContain("call the 'skill' tool");
		expect(result).toContain("Once loaded, the skill will provide detailed instructions");
	});
});
