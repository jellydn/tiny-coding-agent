/**
 * Search Providers
 *
 * Pluggable search backends for the web_search tool.
 */

export type { SearchProvider, SearchResult, SearchProviderOptions } from "./provider.js";
export type { BaseSearchProvider } from "./provider.js";
export { DuckDuckGoProvider } from "./duckduckgo.js";
