/**
 * Search Provider Interface
 *
 * Defines the contract for search providers. This allows plugging in different
 * search backends (DuckDuckGo scraping, Tavily API, Bing API, etc.) without
 * changing the tool implementation.
 */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchProvider {
  /**
   * The name of this search provider
   */
  readonly name: string;

  /**
   * Whether this provider requires an API key
   */
  readonly requiresApiKey: boolean;

  /**
   * Search for results matching the given query
   *
   * @param query - The search query
   * @param maxResults - Maximum number of results to return
   * @returns Array of search results
   * @throws Error if the search fails
   */
  search(query: string, maxResults: number): Promise<SearchResult[]>;
}

/**
 * Configuration for search providers
 */
export interface SearchProviderOptions {
  /**
   * API key for providers that require it (e.g., Tavily, Bing)
   */
  apiKey?: string;

  /**
   * Custom headers for HTTP requests
   */
  headers?: Record<string, string>;

  /**
   * Timeout for search requests in milliseconds
   */
  timeout?: number;
}

/**
 * Base class for search providers with common functionality
 */
export abstract class BaseSearchProvider implements SearchProvider {
  abstract readonly name: string;
  abstract readonly requiresApiKey: boolean;

  protected readonly options: SearchProviderOptions;

  /**
   * Subclasses must implement the search method
   */
  abstract search(query: string, maxResults: number): Promise<SearchResult[]>;

  constructor(options: SearchProviderOptions = {}) {
    this.options = {
      timeout: 10000,
      ...options,
    };
  }

  /**
   * Validate that required configuration is present
   */
  protected validateConfig(): void {
    if (this.requiresApiKey && !this.options.apiKey) {
      throw new Error(`${this.name} provider requires an API key`);
    }
  }

  /**
   * Fetch a URL with timeout and error handling
   */
  protected async fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.options.timeout);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          ...this.options.headers,
          ...init?.headers,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
