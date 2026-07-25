import type { ModelCapabilities } from "./capabilities.js";
import { OpenAIProvider } from "./openai.js";
import type { ChatOptions, ChatResponse, StreamChunk } from "./types.js";

export interface OpenCodeProviderConfig {
	apiKey: string;
	baseUrl?: string;
}

function stripPrefix(model: string): string {
	return model.replace(/^opencode\//, "");
}

/**
 * OpenCode (opencode.ai) is an OpenAI-compatible endpoint whose model names
 * are prefixed with `opencode/`. Inherits chat(), stream(), and tool-call
 * buffering from `OpenAIProvider`; overrides each method to strip the
 * prefix before delegating to super.
 */
export class OpenCodeProvider extends OpenAIProvider {
	constructor(config: OpenCodeProviderConfig) {
		super({
			apiKey: config.apiKey,
			baseUrl: config.baseUrl || "https://opencode.ai/zen/v1",
		});
	}

	override async chat(options: ChatOptions): Promise<ChatResponse> {
		return super.chat({ ...options, model: stripPrefix(options.model) });
	}

	override async *stream(options: ChatOptions): AsyncGenerator<StreamChunk, void, unknown> {
		yield* super.stream({ ...options, model: stripPrefix(options.model) });
	}

	override async getCapabilities(model: string): Promise<ModelCapabilities> {
		return super.getCapabilities(stripPrefix(model));
	}
}
