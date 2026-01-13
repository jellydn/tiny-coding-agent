import type { Tool, ToolResult } from "./types.js";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const DEFAULT_MAX_RESULTS = 5;

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
    const query = args.query as string;
    const maxResults = (args.max_results as number) ?? DEFAULT_MAX_RESULTS;

    if (!query.trim()) {
      return { success: false, error: "Search query cannot be empty" };
    }

    try {
      const results = await searchDuckDuckGo(query, maxResults);

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

async function searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResult[]> {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const html = await response.text();
  return parseSearchResults(html, maxResults);
}

function parseSearchResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];

  const resultPattern =
    /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*(?:<[^>]+>[^<]*)*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([^<]*(?:<[^>]+>[^<]*)*?)<\/a>/gi;

  let match: RegExpExecArray | null = resultPattern.exec(html);
  while (match !== null && results.length < maxResults) {
    const url = decodeURIComponent((match[1] ?? "").replace(/.*uddg=([^&]+).*/, "$1"));
    const title = stripHtmlTags(match[2] ?? "").trim();
    const snippet = stripHtmlTags(match[3] ?? "").trim();

    if (url && title && !url.includes("duckduckgo.com")) {
      results.push({ title, url, snippet });
    }

    match = resultPattern.exec(html);
  }

  if (results.length === 0) {
    const altPattern =
      /<div[^>]+class="[^"]*result[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]*)"[^>]*>([^<]+)<\/a>[\s\S]*?<div[^>]+class="[^"]*snippet[^"]*"[^>]*>([^<]*(?:<[^>]+>[^<]*)*?)<\/div>/gi;

    match = altPattern.exec(html);
    while (match !== null && results.length < maxResults) {
      const url = match[1] ?? "";
      const title = stripHtmlTags(match[2] ?? "").trim();
      const snippet = stripHtmlTags(match[3] ?? "").trim();

      if (url && title && !url.includes("duckduckgo.com")) {
        results.push({ title, url, snippet });
      }

      match = altPattern.exec(html);
    }
  }

  return results;
}

function stripHtmlTags(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ");
}

export const webSearchTools: Tool[] = [webSearchTool];
