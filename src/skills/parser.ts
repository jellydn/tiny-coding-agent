import * as yaml from "yaml";
import type { SkillFrontmatter } from "./types.js";

export interface ParsedSkill {
  frontmatter: SkillFrontmatter;
  body: string;
}

export function parseSkillFrontmatter(content: string): ParsedSkill {
  const lines = content.split("\n");
  let frontmatterStart = -1;
  let frontmatterEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line?.trim() === "---") {
      if (frontmatterStart === -1) {
        frontmatterStart = i;
      } else {
        frontmatterEnd = i;
        break;
      }
    }
  }

  if (frontmatterStart === -1 || frontmatterEnd === -1) {
    throw new Error("Invalid SKILL.md: missing frontmatter delimiters (---)");
  }

  const yamlContent = lines.slice(frontmatterStart + 1, frontmatterEnd).join("\n");
  let body = lines.slice(frontmatterEnd + 1).join("\n");
  if (body.startsWith("\n")) {
    body = body.slice(1);
  }

  let parsed: Partial<SkillFrontmatter>;
  try {
    parsed = yaml.parse(yamlContent) as Partial<SkillFrontmatter>;
  } catch (err) {
    throw new Error(`Invalid YAML in frontmatter: ${(err as Error).message}`);
  }

  if (!("name" in parsed) || typeof parsed.name !== "string") {
    throw new Error("Frontmatter must have a 'name' field");
  }

  if (!("description" in parsed) || typeof parsed.description !== "string") {
    throw new Error("Frontmatter must have a 'description' field");
  }

  const nameValidation = validateSkillName(parsed.name!);
  if (!nameValidation.valid) {
    throw new Error(`Invalid skill name: ${nameValidation.error}`);
  }

  const descriptionValidation = validateDescription(parsed.description!);
  if (!descriptionValidation.valid) {
    throw new Error(`Invalid description: ${descriptionValidation.error}`);
  }

  const frontmatter: SkillFrontmatter = {
    name: parsed.name,
    description: parsed.description,
    license: parsed.license,
    compatibility: parsed.compatibility,
    metadata: parsed.metadata,
    allowedTools: parseAllowedTools(parsed.allowedTools),
  };

  return { frontmatter, body };
}

interface ValidationResult {
  valid: boolean;
  error?: string;
}

function parseAllowedTools(value: unknown): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") {
      return undefined;
    }
    return trimmed.split(/\s+/).filter((tool) => tool.length > 0);
  }
  return undefined;
}

function validateSkillName(name: string): ValidationResult {
  if (name.length < 1 || name.length > 64) {
    return { valid: false, error: "must be 1-64 characters" };
  }

  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
    return {
      valid: false,
      error: "must be lowercase alphanumeric with hyphens, no leading/trailing/consecutive hyphens",
    };
  }

  return { valid: true };
}

function validateDescription(description: string): ValidationResult {
  if (description.length < 1 || description.length > 1024) {
    return { valid: false, error: "must be 1-1024 characters" };
  }

  if (description.trim().length === 0) {
    return { valid: false, error: "must not be empty or whitespace only" };
  }

  return { valid: true };
}
