export interface ProviderCapabilities {
	supportsTools: boolean;
	supportsStreaming: boolean;
	supportsSystemPrompt: boolean;
	supportsToolStreaming: boolean;
	supportsThinking: boolean;
}

export interface ModelCapabilities extends ProviderCapabilities {
	modelName: string;
	contextWindow?: number;
	maxOutputTokens?: number;
	/** Indicates if capabilities were fetched from provider API (true) or are inferred/defaults (false) */
	isVerified?: boolean;
}
