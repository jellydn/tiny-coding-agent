export interface ToolResult {
	success: boolean;
	output?: string;
	error?: string;
}

export type ToolDangerLevel = boolean | string | ((args: Record<string, unknown>) => boolean | string | undefined);

export interface Tool {
	name: string;
	description: string;
	parameters: ToolParameters;
	dangerous?: ToolDangerLevel;
	execute(args: Record<string, unknown>): Promise<ToolResult>;
}

export interface ToolParameters {
	type: "object";
	properties: Record<string, unknown>;
	required?: string[];
	[key: string]: unknown;
}

export interface OpenAIFunctionDef {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: ToolParameters;
	};
}

export interface AnthropicToolDef {
	name: string;
	description: string;
	input_schema: ToolParameters;
}
