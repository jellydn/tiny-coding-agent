import { describe, it, expect } from "bun:test";
import { parseSkillFrontmatter } from "../../src/skills/parser.js";

describe("parseSkillFrontmatter", () => {
  describe("valid frontmatter", () => {
    it("should parse frontmatter and body correctly", () => {
      const content = `---
name: my-skill
description: A test skill
---

# Body content

This is the skill body.`;

      const result = parseSkillFrontmatter(content);

      expect(result.frontmatter.name).toBe("my-skill");
      expect(result.frontmatter.description).toBe("A test skill");
      expect(result.body).toBe("# Body content\n\nThis is the skill body.");
    });

    it("should parse optional fields", () => {
      const content = `---
name: test-skill
description: A test skill
license: MIT
compatibility:
  claude: ">= 3.5"
allowedTools:
  - read
  - write
metadata:
  version: "1.0"
---

Skill body here.`;

      const result = parseSkillFrontmatter(content);

      expect(result.frontmatter.name).toBe("test-skill");
      expect(result.frontmatter.description).toBe("A test skill");
      expect(result.frontmatter.license).toBe("MIT");
      expect(result.frontmatter.compatibility).toEqual({ claude: ">= 3.5" });
      expect(result.frontmatter.allowedTools).toEqual(["read", "write"]);
      expect(result.frontmatter.metadata).toEqual({ version: "1.0" });
    });

    it("should handle body-only content", () => {
      const content = `---
name: minimal-skill
description: Minimal skill without body
---

`;

      const result = parseSkillFrontmatter(content);

      expect(result.frontmatter.name).toBe("minimal-skill");
      expect(result.frontmatter.description).toBe("Minimal skill without body");
      expect(result.body).toBe("");
    });
  });

  describe("name validation", () => {
    it("should reject name with uppercase", () => {
      const content = `---
name: My-Skill
description: Invalid name
---

Body`;

      expect(() => parseSkillFrontmatter(content)).toThrow(
        "Skill name must be lowercase alphanumeric with hyphens, no leading/trailing/consecutive hyphens",
      );
    });

    it("should reject name with special characters", () => {
      const content = `---
name: test_skill
description: Invalid name
---

Body`;

      expect(() => parseSkillFrontmatter(content)).toThrow(
        "Skill name must be lowercase alphanumeric with hyphens, no leading/trailing/consecutive hyphens",
      );
    });

    it("should reject empty name", () => {
      const content = `---
name: ""
description: Invalid name
---

Body`;

      expect(() => parseSkillFrontmatter(content)).toThrow("Skill name must be 1-64 characters");
    });

    it("should reject name over 64 characters", () => {
      const longName = "a".repeat(65);
      const content = `---
name: ${longName}
description: Invalid name
---

Body`;

      expect(() => parseSkillFrontmatter(content)).toThrow("Skill name must be 1-64 characters");
    });

    it("should reject name starting with hyphen", () => {
      const content = `---
name: -test
description: Invalid name
---

Body`;

      expect(() => parseSkillFrontmatter(content)).toThrow(
        "Skill name must be lowercase alphanumeric with hyphens, no leading/trailing/consecutive hyphens",
      );
    });

    it("should reject name ending with hyphen", () => {
      const content = `---
name: test-
description: Invalid name
---

Body`;

      expect(() => parseSkillFrontmatter(content)).toThrow(
        "Skill name must be lowercase alphanumeric with hyphens, no leading/trailing/consecutive hyphens",
      );
    });

    it("should reject consecutive hyphens", () => {
      const content = `---
name: test--skill
description: Invalid name
---

Body`;

      expect(() => parseSkillFrontmatter(content)).toThrow(
        "Skill name must be lowercase alphanumeric with hyphens, no leading/trailing/consecutive hyphens",
      );
    });
  });

  describe("description validation", () => {
    it("should reject empty description", () => {
      const content = `---
name: test-skill
description: ""
---

Body`;

      expect(() => parseSkillFrontmatter(content)).toThrow("Description must be 1-1024 characters");
    });

    it("should reject description over 1024 characters", () => {
      const longDescription = "a".repeat(1025);
      const content = `---
name: test-skill
description: ${longDescription}
---

Body`;

      expect(() => parseSkillFrontmatter(content)).toThrow("Description must be 1-1024 characters");
    });

    it("should reject whitespace-only description", () => {
      const content = `---
name: test-skill
description: "   "
---

Body`;

      expect(() => parseSkillFrontmatter(content)).toThrow(
        "Description must not be empty or whitespace only",
      );
    });
  });

  describe("error handling", () => {
    it("should throw error when frontmatter delimiters are missing", () => {
      const content = `name: test-skill
description: No delimiters
---

Body`;

      expect(() => parseSkillFrontmatter(content)).toThrow(
        "Invalid SKILL.md: missing frontmatter delimiters (---)",
      );
    });

    it("should throw error when only opening delimiter exists", () => {
      const content = `---
name: test-skill
description: Incomplete
Body here`;

      expect(() => parseSkillFrontmatter(content)).toThrow(
        "Invalid SKILL.md: missing frontmatter delimiters (---)",
      );
    });

    it("should throw error for invalid YAML", () => {
      const content = `---
name: [invalid yaml
description: Bad YAML
---

Body`;

      expect(() => parseSkillFrontmatter(content)).toThrow("Invalid YAML in frontmatter");
    });

    it("should throw error when name is missing", () => {
      const content = `---
description: No name
---

Body`;

      expect(() => parseSkillFrontmatter(content)).toThrow("Frontmatter must have a 'name' field");
    });

    it("should throw error when description is missing", () => {
      const content = `---
name: test-skill
---

Body`;

      expect(() => parseSkillFrontmatter(content)).toThrow(
        "Frontmatter must have a 'description' field",
      );
    });
  });
});
