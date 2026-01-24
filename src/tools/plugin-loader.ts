import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, extname } from "node:path";
import type { Tool } from "./types.js";

const PLUGINS_DIR = join(homedir(), ".tiny-agent", "plugins");

export interface PluginModule {
  default?: Tool | Tool[];
}

async function loadPluginFile(filePath: string): Promise<Tool[]> {
  const ext = extname(filePath);
  if (ext !== ".js" && ext !== ".ts" && ext !== ".mjs") {
    return [];
  }

  try {
    const module = (await import(`file://${filePath}`)) as PluginModule;
    const exported = module.default;

    if (!exported) {
      return [];
    }

    if (Array.isArray(exported)) {
      return exported.filter(isTool);
    }

    if (isTool(exported)) {
      return [exported];
    }

    return [];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to load plugin ${filePath}: ${message}`);
  }
}

function isTool(obj: unknown): obj is Tool {
  if (obj === null || typeof obj !== "object") {
    return false;
  }

  const tool = obj as Record<string, unknown>;
  return (
    typeof tool.name === "string" &&
    typeof tool.description === "string" &&
    typeof tool.parameters === "object" &&
    typeof tool.execute === "function"
  );
}

export async function loadPlugins(): Promise<Tool[]> {
  const tools: Tool[] = [];

  if (!existsSync(PLUGINS_DIR)) {
    return tools;
  }

  const files = readdirSync(PLUGINS_DIR);
  const loadErrors: Array<{ file: string; error: string }> = [];

  for (const file of files) {
    const filePath = join(PLUGINS_DIR, file);
    try {
      const pluginTools = await loadPluginFile(filePath);
      tools.push(...pluginTools);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      loadErrors.push({ file, error: message });
      console.error(`Warning: Failed to load plugin from ${file}: ${message}`);
    }
  }

  // Report summary of plugin loading issues
  if (loadErrors.length > 0) {
    console.error(
      `Failed to load ${loadErrors.length} plugin(s): ${loadErrors.map((e) => e.file).join(", ")}`,
    );
  }

  return tools;
}
