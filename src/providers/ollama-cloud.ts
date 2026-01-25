import type { ModelCapabilities } from "./capabilities.js";
import { OllamaProvider } from "./ollama.js";
import type { ChatOptions, ChatResponse, LLMClient, StreamChunk } from "./types.js";

export interface OllamaCloudProviderConfig {
	apiKey: string;
	baseUrl?: string;
}

export class OllamaCloudProvider implements LLMClient {
	private _delegate: OllamaProvider;

	constructor(config: OllamaCloudProviderConfig) {
		this._delegate = new OllamaProvider({
			apiKey: config.apiKey,
			baseUrl: config.baseUrl || "https://ollama.com",
		});
	}

	async chat(options: ChatOptions): Promise<ChatResponse> {
		return this._delegate.chat(options);
	}

	async *stream(options: ChatOptions): AsyncGenerator<StreamChunk, void, unknown> {
		yield* this._delegate.stream(options);
	}

	async getCapabilities(model: string): Promise<ModelCapabilities> {
		return this._delegate.getCapabilities(model);
	}
}
