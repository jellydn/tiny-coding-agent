export interface SkillMetadata {
	name: string;
	description: string;
	location: string;
	isBuiltin?: boolean;
	allowedTools?: string[];
}

export interface SkillFrontmatter {
	name: string;
	description: string;
	license?: string;
	compatibility?: Record<string, string>;
	metadata?: Record<string, unknown>;
	allowedTools?: string[];
}

export interface Skill extends SkillMetadata {
	body: string;
	frontmatter: SkillFrontmatter;
}
