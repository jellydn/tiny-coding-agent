import type { Tool, OpenAIFunctionDef, AnthropicToolDef } from "./types.js";

export class ToolRegistry {
  private _tools: Map<string, Tool> = new Map();

  register(tool: Tool): void {
    if (this._tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this._tools.set(tool.name, tool);
  }

  registerMany(tools: Tool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  unregister(name: string): boolean {
    return this._tools.delete(name);
  }

  get(name: string): Tool | undefined {
    return this._tools.get(name);
  }

  has(name: string): boolean {
    return this._tools.has(name);
  }

  list(): Tool[] {
    return Array.from(this._tools.values());
  }

  names(): string[] {
    return Array.from(this._tools.keys());
  }

  clear(): void {
    this._tools.clear();
  }

  toOpenAIFormat(): OpenAIFunctionDef[] {
    return this.list().map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  toAnthropicFormat(): AnthropicToolDef[] {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{
    success: boolean;
    output?: string;
    error?: string;
  }> {
    const tool = this._tools.get(name);
    if (!tool) {
      return {
        success: false,
        error: `Tool "${name}" not found`,
      };
    }

    try {
      return await tool.execute(args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: message,
      };
    }
  }
}
