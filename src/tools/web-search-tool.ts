import type { Tool, ToolResult } from "./types.js";
import { z } from "zod";
import type { SearchProvider } from "./search-providers/index.js";
import { DuckDuckGoProvider } from "./search-providers/index.js";

const DEFAULT_MAX_RESULTS = 5;

/**
 * Global search provider instance
 * Can be replaced with a different provider via setGlobalSearchProvider()
 */
let _globalSearchProvider: SearchProvider = new DuckDuckGoProvider();

/**
 * Set the global search provider for web_search tool
 *
 * @example
 * ```typescript
 * import { TavilyProvider } from './search-providers/index.js';
 * setGlobalSearchProvider(new TavilyProvider({ apiKey: process.env.TAVILY_API_KEY }));
 * ```
 */
export function setGlobalSearchProvider(provider: SearchProvider): void {
  _globalSearchProvider = provider;
}

/**
 * Get the current global search provider
 */
export function getGlobalSearchProvider(): SearchProvider {
  return _globalSearchProvider;
}

const webSearchArgsSchema = z.object({
  query: z.string(),
  max_results: z.number().optional(),
});

export const webSearchTool: Tool = {
  name: "web_search",
  description:
    "Search the web for documentation, answers, and information. Returns title, URL, and snippet for each result.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query",
      },
      max_results: {
        type: "number",
        description: `Maximum number of results to return (default: ${DEFAULT_MAX_RESULTS})`,
      },
    },
    required: ["query"],
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const parsed = webSearchArgsSchema.safeParse(args);
    if (!parsed.success) {
      return { success: false, error: `Invalid arguments: ${parsed.error.message}` };
    }

    const { query, max_results } = parsed.data;
    const maxResults = max_results ?? DEFAULT_MAX_RESULTS;

    if (!query.trim()) {
      return { success: false, error: "Search query cannot be empty" };
    }

    // Special case: latest npm package version
    const versionMatch = query.match(/latest\s+(?:npm\s+)?version\s+of\s+(\w+)/i);
    if (versionMatch && versionMatch[1]) {
      try {
        const packageName = versionMatch[1];
        const version = await getNpmVersion(packageName);
        return {
          success: true,
          output: `The latest version of ${packageName} is ${version} (from npmjs.com).`,
        };
      } catch {
        // Fall through to regular search
      }
    }

    try {
      const results = await _globalSearchProvider.search(query, maxResults);

      if (results.length === 0) {
        return { success: true, output: "No search results found." };
      }

      const output = results
        .map((r, i) => `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`)
        .join("\n\n");

      return { success: true, output };
    } catch (err) {
      const error = err as Error;
      return { success: false, error: `Search failed: ${error.message}` };
    }
  },
};

async function getNpmVersion(packageName: string): Promise<string> {
  const response = await fetch(`https://registry.npmjs.org/${packageName}/latest`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = (await response.json()) as { version: string };
  return data.version;
}

export const webSearchTools: Tool[] = [webSearchTool];
