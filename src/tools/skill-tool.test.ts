import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createSkillTool } from "./skill-tool.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import * as path from "node:path";

describe("skill tool", () => {
  const testSkillDir = "/tmp/test-skills";
  const testSkillPath = path.join(testSkillDir, "test-skill", "SKILL.md");

  beforeEach(() => {
    try {
      rmSync(testSkillDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    mkdirSync(path.dirname(testSkillPath), { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testSkillDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  describe("execute", () => {
    it("should return error when skill name is missing", async () => {
      const skillRegistry = new Map<
        string,
        { name: string; description: string; location: string }
      >();
      const tool = createSkillTool(skillRegistry);
      const result = await tool.execute({});
      expect(result.success).toBe(false);
      expect(result.error).toBe("Skill name is required");
    });

    it("should return error when skill not found in registry", async () => {
      const skillRegistry = new Map<
        string,
        { name: string; description: string; location: string }
      >();
      const tool = createSkillTool(skillRegistry);
      const result = await tool.execute({ name: "nonexistent" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Skill not found: nonexistent");
    });

    it("should load skill content and wrap in XML", async () => {
      const skillContent = `---
name: test-skill
description: A test skill
---
# Test Skill

This is the body content.`;

      writeFileSync(testSkillPath, skillContent, "utf-8");

      const skillRegistry = new Map<
        string,
        { name: string; description: string; location: string }
      >();
      skillRegistry.set("test-skill", {
        name: "test-skill",
        description: "A test skill",
        location: testSkillPath,
      });

      const tool = createSkillTool(skillRegistry);
      const result = await tool.execute({ name: "test-skill" });

      expect(result.success).toBe(true);
      expect(result.output).toContain('<loaded_skill name="test-skill"');
      expect(result.output).toContain(testSkillDir);
      expect(result.output).toContain("# Test Skill");
      expect(result.output).toContain("</loaded_skill>");
    });

    it("should return error when skill file is missing", async () => {
      const missingPath = "/tmp/nonexistent-skill/SKILL.md";
      const skillRegistry = new Map<
        string,
        { name: string; description: string; location: string }
      >();
      skillRegistry.set("nonexistent-skill", {
        name: "nonexistent-skill",
        description: "A nonexistent skill",
        location: missingPath,
      });

      const tool = createSkillTool(skillRegistry);
      const result = await tool.execute({ name: "nonexistent-skill" });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Skill file not found");
    });

    it("should list available skills in error message", async () => {
      const skillRegistry = new Map<
        string,
        { name: string; description: string; location: string }
      >();
      skillRegistry.set("skill-one", {
        name: "skill-one",
        description: "First skill",
        location: "/tmp/1/SKILL.md",
      });
      skillRegistry.set("skill-two", {
        name: "skill-two",
        description: "Second skill",
        location: "/tmp/2/SKILL.md",
      });

      const tool = createSkillTool(skillRegistry);
      const result = await tool.execute({ name: "unknown" });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Available skills: skill-one, skill-two");
    });

    it("should handle empty registry gracefully", async () => {
      const skillRegistry = new Map<
        string,
        { name: string; description: string; location: string }
      >();
      const tool = createSkillTool(skillRegistry);
      const result = await tool.execute({ name: "anything" });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Available skills: none");
    });

    it("should parse allowed-tools from frontmatter and call onSkillLoaded callback", async () => {
      const skillContent = `---
name: test-skill
description: A test skill
allowed-tools: read bash glob
---
# Test Skill

This is the body content.`;

      writeFileSync(testSkillPath, skillContent, "utf-8");

      const skillRegistry = new Map<
        string,
        { name: string; description: string; location: string }
      >();
      skillRegistry.set("test-skill", {
        name: "test-skill",
        description: "A test skill",
        location: testSkillPath,
      });

      let capturedAllowedTools: string[] | undefined;
      const tool = createSkillTool(skillRegistry, (allowedTools) => {
        capturedAllowedTools = allowedTools;
      });

      const result = await tool.execute({ name: "test-skill" });

      expect(result.success).toBe(true);
      expect(capturedAllowedTools).toEqual(["read", "bash", "glob"]);
    });

    it("should pass undefined to onSkillLoaded when no allowed-tools in frontmatter", async () => {
      const skillContent = `---
name: test-skill
description: A test skill
---
# Test Skill

This is the body content.`;

      writeFileSync(testSkillPath, skillContent, "utf-8");

      const skillRegistry = new Map<
        string,
        { name: string; description: string; location: string }
      >();
      skillRegistry.set("test-skill", {
        name: "test-skill",
        description: "A test skill",
        location: testSkillPath,
      });

      let capturedAllowedTools: string[] | undefined;
      const tool = createSkillTool(skillRegistry, (allowedTools) => {
        capturedAllowedTools = allowedTools;
      });

      const result = await tool.execute({ name: "test-skill" });

      expect(result.success).toBe(true);
      expect(capturedAllowedTools).toBeUndefined();
    });

    it("should handle allowed-tools as array in frontmatter", async () => {
      const skillContent = `---
name: test-skill
description: A test skill
allowed-tools:
  - read
  - bash
  - glob
---
# Test Skill`;

      writeFileSync(testSkillPath, skillContent, "utf-8");

      const skillRegistry = new Map<
        string,
        { name: string; description: string; location: string }
      >();
      skillRegistry.set("test-skill", {
        name: "test-skill",
        description: "A test skill",
        location: testSkillPath,
      });

      let capturedAllowedTools: string[] | undefined;
      const tool = createSkillTool(skillRegistry, (allowedTools) => {
        capturedAllowedTools = allowedTools;
      });

      const result = await tool.execute({ name: "test-skill" });

      expect(result.success).toBe(true);
      expect(capturedAllowedTools).toEqual(["read", "bash", "glob"]);
    });

    it("should handle empty allowed-tools gracefully", async () => {
      const skillContent = `---
name: test-skill
description: A test skill
allowed-tools: ""
---
# Test Skill`;

      writeFileSync(testSkillPath, skillContent, "utf-8");

      const skillRegistry = new Map<
        string,
        { name: string; description: string; location: string }
      >();
      skillRegistry.set("test-skill", {
        name: "test-skill",
        description: "A test skill",
        location: testSkillPath,
      });

      let capturedAllowedTools: string[] | undefined;
      const tool = createSkillTool(skillRegistry, (allowedTools) => {
        capturedAllowedTools = allowedTools;
      });

      const result = await tool.execute({ name: "test-skill" });

      expect(result.success).toBe(true);
      expect(capturedAllowedTools).toBeUndefined();
    });
  });
});
