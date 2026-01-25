import { describe, it, expect } from "bun:test";
import type { SkillMetadata } from "../../src/skills/types.js";
import { generateSkillsPrompt } from "../../src/skills/prompt.js";

describe("generateSkillsPrompt", () => {
  it("should return empty string for empty skills array", () => {
    const result = generateSkillsPrompt([]);
    expect(result).toBe("");
  });

  it("should generate XML for single skill", () => {
    const skills: SkillMetadata[] = [
      { name: "test-skill", description: "A test skill", location: "/path/to/skill" },
    ];
    const result = generateSkillsPrompt(skills);
    expect(result).toBe(
      "<available_skills><skill><name>test-skill</name><description>A test skill</description><location>/path/to/skill</location></skill></available_skills>",
    );
  });

  it("should generate XML for multiple skills", () => {
    const skills: SkillMetadata[] = [
      { name: "skill-one", description: "First skill", location: "/path/one" },
      { name: "skill-two", description: "Second skill", location: "/path/two" },
      { name: "skill-three", description: "Third skill", location: "/path/three" },
    ];
    const result = generateSkillsPrompt(skills);
    expect(result).toBe(
      "<available_skills><skill><name>skill-one</name><description>First skill</description><location>/path/one</location></skill><skill><name>skill-two</name><description>Second skill</description><location>/path/two</location></skill><skill><name>skill-three</name><description>Third skill</description><location>/path/three</location></skill></available_skills>",
    );
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
    expect(result).toBe(
      "<available_skills><skill><name>my-skill</name><description>A skill with &lt;brackets&gt; &amp; ampersands</description><location>/path/skill</location></skill></available_skills>",
    );
  });

  it("should handle skills with hyphens in name", () => {
    const skills: SkillMetadata[] = [
      { name: "my-custom-skill-123", description: "Test description", location: "/path" },
    ];
    const result = generateSkillsPrompt(skills);
    expect(result).toContain("<name>my-custom-skill-123</name>");
  });
});
