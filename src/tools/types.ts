export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
}

export interface ToolParameters {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}

export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameters;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
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
