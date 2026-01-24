import type { Tool, OpenAIFunctionDef, AnthropicToolDef } from "./types.js";
import { getConfirmationHandler } from "./confirmation.js";

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

  private _getDangerLevel(name: string, args: Record<string, unknown>): string | undefined {
    const tool = this._tools.get(name);
    const dangerous = tool?.dangerous;
    if (!dangerous) return undefined;

    if (typeof dangerous === "function") {
      const result = dangerous(args);
      if (typeof result === "string") return result;
      if (result === true) return `Execute ${name}`;
      return undefined;
    }

    return typeof dangerous === "string" ? dangerous : `Execute ${name}`;
  }

  isDangerous(name: string, args: Record<string, unknown>): boolean {
    return this._getDangerLevel(name, args) !== undefined;
  }

  getDangerLevel(name: string, args: Record<string, unknown>): string | undefined {
    return this._getDangerLevel(name, args);
  }

  async executeBatch(
    calls: Array<{ name: string; args: Record<string, unknown> }>,
  ): Promise<
    Array<{ name: string; result: { success: boolean; output?: string; error?: string } }>
  > {
    const dangerousCalls = calls.filter((c) => this.isDangerous(c.name, c.args));

    // No dangerous calls or no handler - execute all
    if (dangerousCalls.length === 0) {
      return Promise.all(calls.map(async (c) => ({ name: c.name, result: await this.execute(c.name, c.args) })));
    }

    const handler = getConfirmationHandler();
    if (!handler) {
      return Promise.all(calls.map(async (c) => ({ name: c.name, result: await this.execute(c.name, c.args) })));
    }

    const actions = dangerousCalls.map((c) => ({
      tool: c.name,
      description: this.getDangerLevel(c.name, c.args) ?? "Execute",
      args: c.args,
    }));

    const approved = await handler({ actions });

    // All declined - execute only safe tools
    if (approved === false) {
      return Promise.all(calls.map(async (c) => {
        if (this.isDangerous(c.name, c.args)) {
          return { name: c.name, result: { success: false, error: "User declined confirmation" } };
        }
        return { name: c.name, result: await this.execute(c.name, c.args) };
      }));
    }

    // Partial approval - execute only selected dangerous tool plus safe tools
    if (typeof approved === "object" && approved.type === "partial") {
      const selectedToolName = dangerousCalls[approved.selectedIndex]?.name;
      return Promise.all(calls.map(async (c) => {
        if (this.isDangerous(c.name, c.args) && c.name !== selectedToolName) {
          return { name: c.name, result: { success: false, error: "User declined confirmation" } };
        }
        return { name: c.name, result: await this.execute(c.name, c.args) };
      }));
    }

    // All approved - execute all
    return Promise.all(calls.map(async (c) => ({ name: c.name, result: await this.execute(c.name, c.args) })));
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
      return { success: false, error: `Tool "${name}" not found` };
    }

    try {
      return await tool.execute(args);
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
