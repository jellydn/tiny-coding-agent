import type { SearchResult } from "./provider.js";
import { BaseSearchProvider } from "./provider.js";

/**
 * DuckDuckGo Search Provider (HTML scraping)
 *
 * This provider scrapes DuckDuckGo's HTML results. It's free but may be fragile
 * if DuckDuckGo changes their HTML structure. Use API-based providers for production.
 */
export class DuckDuckGoProvider extends BaseSearchProvider {
	readonly name = "duckduckgo";
	readonly requiresApiKey = false;

	async search(query: string, maxResults: number): Promise<SearchResult[]> {
		const encodedQuery = encodeURIComponent(query);
		const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

		const response = await this.fetchWithTimeout(url, {
			headers: {
				"User-Agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
				Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
				"Accept-Language": "en-US,en;q=0.5",
			},
		});

		const html = await response.text();
		const results = this.parseSearchResults(html, maxResults);

		return this.prioritizeAuthoritativeSources(results);
	}

	/**
	 * Check if a result is valid (has required fields and is not a DuckDuckGo URL)
	 */
	private isValidResult(url: string, title: string): boolean {
		return !!url && !!title && this.isValidUrl(url) && !url.includes("duckduckgo.com");
	}

	/**
	 * Parse HTML and extract search results
	 * Uses multiple fallback patterns for robustness
	 */
	private parseSearchResults(html: string, maxResults: number): SearchResult[] {
		const results: SearchResult[] = [];
		const seenUrls = new Set<string>();

		// Match DuckDuckGo result links with optional snippets
		const linkPattern = /<a[^>]+href="([^"]*)"[^>]*>([^<]*(?:<[^>]+>[^<]*)*?)<\/a>/gi;

		let match: RegExpExecArray | null = linkPattern.exec(html);
		while (match !== null && results.length < maxResults) {
			try {
				const rawUrl = match[1] ?? "";
				const title = this.stripHtmlTags(match[2] ?? "").trim();

				// Extract actual URL from DuckDuckGo redirect
				const urlMatch = rawUrl.match(/uddg=([^&]+)/);
				const url = urlMatch?.[1] ? decodeURIComponent(urlMatch[1]) : rawUrl;

				// Skip DuckDuckGo internal URLs and duplicates
				if (url.includes("duckduckgo.com") || seenUrls.has(url)) {
					match = linkPattern.exec(html);
					continue;
				}

				if (this.isValidResult(url, title)) {
					seenUrls.add(url);
					results.push({ title, url, snippet: "No description available." });
				}
			} catch {
				// Skip malformed results
			}

			match = linkPattern.exec(html);
		}

		return results;
	}

	/**
	 * Prioritize results from authoritative sources
	 */
	private prioritizeAuthoritativeSources(results: SearchResult[]): SearchResult[] {
		const AUTHORITATIVE_DOMAINS = [
			"npmjs.com",
			"github.com",
			"zod.dev",
			"typescriptlang.org",
			"developer.mozilla.org",
			"stackoverflow.com",
			"docs.rs",
			"pytorch.org",
			"readthedocs.io",
		];

		const sorted = [...results].sort((a, b) => {
			const aAuthoritative = AUTHORITATIVE_DOMAINS.some((d) => a.url.includes(d));
			const bAuthoritative = AUTHORITATIVE_DOMAINS.some((d) => b.url.includes(d));

			if (aAuthoritative && !bAuthoritative) return -1;
			if (!aAuthoritative && bAuthoritative) return 1;
			return 0;
		});

		return sorted;
	}

	/**
	 * Basic URL validation
	 */
	private isValidUrl(url: string): boolean {
		try {
			const parsed = new URL(url);
			return parsed.protocol === "http:" || parsed.protocol === "https:";
		} catch {
			return false;
		}
	}

	/**
	 * Strip HTML tags and decode common entities
	 */
	private stripHtmlTags(text: string): string {
		return text
			.replace(/<[^>]*>/g, "")
			.replace(/&[^;]+;/g, (m) => {
				const entities: Record<string, string> = {
					"&quot;": '"',
					"&amp;": "&",
					"&lt;": "<",
					"&gt;": ">",
					"&nbsp;": " ",
					"&#39;": "'",
				};
				return entities[m] || m;
			})
			.replace(/\s+/g, " ");
	}
}
