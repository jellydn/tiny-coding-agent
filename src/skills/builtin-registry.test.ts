import { describe, it, expect } from "bun:test";
import { getEmbeddedBuiltinSkills, getEmbeddedSkillContent } from "./builtin-registry.js";

describe("builtin-registry", () => {
  describe("getEmbeddedBuiltinSkills", () => {
    it("should return at least one embedded skill", () => {
      const skills = getEmbeddedBuiltinSkills();
      expect(skills.length).toBeGreaterThanOrEqual(1);
    });

    it("should include code-simplifier skill", () => {
      const skills = getEmbeddedBuiltinSkills();
      const codeSimplifier = skills.find((s) => s.name === "code-simplifier");
      expect(codeSimplifier).toBeDefined();
    });

    it("should mark skills as builtin", () => {
      const skills = getEmbeddedBuiltinSkills();
      for (const skill of skills) {
        expect(skill.isBuiltin).toBe(true);
      }
    });

    it("should have builtin location format", () => {
      const skills = getEmbeddedBuiltinSkills();
      for (const skill of skills) {
        expect(skill.location).toStartWith("builtin://");
      }
    });

    it("should have valid skill metadata", () => {
      const skills = getEmbeddedBuiltinSkills();
      for (const skill of skills) {
        expect(typeof skill.name).toBe("string");
        expect(skill.name.length).toBeGreaterThan(0);
        expect(typeof skill.description).toBe("string");
        expect(skill.description.length).toBeGreaterThan(0);
      }
    });

    it("should have code-simplifier with correct description", () => {
      const skills = getEmbeddedBuiltinSkills();
      const codeSimplifier = skills.find((s) => s.name === "code-simplifier");
      expect(codeSimplifier).toBeDefined();
      expect(codeSimplifier!.description).toBe(
        "Refine code for clarity and maintainability while preserving functionality",
      );
    });

    it("should return consistent results across multiple calls", () => {
      const skills1 = getEmbeddedBuiltinSkills();
      const skills2 = getEmbeddedBuiltinSkills();
      expect(skills1).toEqual(skills2);
    });

    it("should parse allowedTools from embedded skill frontmatter", () => {
      const skills = getEmbeddedBuiltinSkills();
      const codeSimplifier = skills.find((s) => s.name === "code-simplifier");
      expect(codeSimplifier).toBeDefined();
      // The code-simplifier doesn't specify allowedTools, so it should be undefined
      expect(codeSimplifier!.allowedTools).toBeUndefined();
    });
  });

  describe("getEmbeddedSkillContent", () => {
    it("should return content for existing skill", () => {
      const content = getEmbeddedSkillContent("code-simplifier");
      expect(content).toBeDefined();
      expect(content!.length).toBeGreaterThan(0);
    });

    it("should return null for non-existent skill", () => {
      const content = getEmbeddedSkillContent("nonexistent-skill");
      expect(content).toBeNull();
    });

    it("should return content with valid frontmatter", () => {
      const content = getEmbeddedSkillContent("code-simplifier");
      expect(content).toContain("---");
      expect(content).toContain("name: code-simplifier");
      expect(content).toContain("description:");
    });

    it("should return content with skill body", () => {
      const content = getEmbeddedSkillContent("code-simplifier");
      expect(content).toContain("You are a code simplification expert");
    });

    it("should return consistent results across multiple calls", () => {
      const content1 = getEmbeddedSkillContent("code-simplifier");
      const content2 = getEmbeddedSkillContent("code-simplifier");
      expect(content1).toEqual(content2);
    });

    it("should handle empty string skill name", () => {
      const content = getEmbeddedSkillContent("");
      expect(content).toBeNull();
    });

    it("should handle case-sensitive skill names", () => {
      const contentLower = getEmbeddedSkillContent("code-simplifier");
      const contentUpper = getEmbeddedSkillContent("CODE-SIMPLIFIER");
      const contentMixed = getEmbeddedSkillContent("Code-Simplifier");

      expect(contentLower).toBeDefined();
      expect(contentUpper).toBeNull();
      expect(contentMixed).toBeNull();
    });
  });

  describe("integration", () => {
    it("metadata should match content frontmatter", () => {
      const skills = getEmbeddedBuiltinSkills();

      for (const skill of skills) {
        const content = getEmbeddedSkillContent(skill.name);
        expect(content).toBeDefined();

        // Verify metadata matches content
        expect(content).toContain(`name: ${skill.name}`);
        expect(content).toContain(`description: ${skill.description}`);
      }
    });

    it("embedded skills should be discoverable", () => {
      const skills = getEmbeddedBuiltinSkills();

      // Verify each skill's metadata is valid
      for (const skill of skills) {
        // These skills should be loadable
        const content = getEmbeddedSkillContent(skill.name);
        expect(content).not.toBeNull();
        expect(content).toContain(skill.description);
      }
    });
  });
});
