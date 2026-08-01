import { loadAgentsMd } from "../config/loader.js";
import type { ObservabilityConfig, ThinkingConfig } from "../config/schema.js";
import type { McpManager } from "../mcp/manager.js";
import { parseModelString } from "../providers/factory.js";
import { detectProvider } from "../providers/model-registry.js";
import type { LLMClient, Message, TokenUsage } from "../providers/types.js";
import { getBuiltinSkillsDir, type SkillMetadata } from "../skills/index.js";
import type { ToolRegistry } from "../tools/registry.js";
import { AgentObservability } from "./agent-observability.js";

import { buildContextStats, type PrepareContextResult, prepareContext } from "./context-budget.js";
import { ConversationManager } from "./conversation.js";
import { DebugLogger } from "./debug-logger.js";
import type { ContextStats } from "./memory.js";
import { MemoryStore } from "./memory.js";
import { ProviderCache, type ProviderConfigs } from "./provider-cache.js";
import { RunnerObservability } from "./runner-observability.js";
import { SkillManager } from "./skill-manager.js";
import { StreamProcessor } from "./stream-processor.js";
import { TurnExecutor } from "./turn-executor.js";

// Tool categorization: core tools always included, others filtered by relevance heuristic
const CORE_TOOLS = new Set(["read_file", "write_file", "edit_file", "list_directory", "bash", "grep", "glob"]);

/**
 * Infer which tool categories are relevant based on the user's prompt.
 * Returns a set of category names to include in addition to core tools.
 */
function inferRelevantCategories(prompt: string): Set<string> {
	const categories = new Set<string>();

	// File operations (destructive): delete, remove
	if (/\b(?:delete|remove|rm\b)/i.test(prompt)) {
		categories.add("file");
	}

	// Web/search: search, web, find, lookup, docs, documentation
	if (/\b(?:search\b|web\b|find\b|lookup\b|docs?\s|documentation)/i.test(prompt)) {
		categories.add("search");
	}

	return categories;
}

// Re-export for backward compatibility — other modules and tests import
// isLooping, truncateOutput, and streamLlmResponse from agent.ts. The
// canonical home is agent-utils.ts (extracted to break the agent.ts ↔
// turn-executor.ts cycle and to eliminate the duplicate stream pattern).
export { isLooping, streamLlmResponse, truncateOutput } from "./agent-utils.js";

export function redactApiKey(key?: string): string {
	if (!key) return "(not set)";
	if (key.length <= 8) return "****";
	return `${key.slice(0, 4)}...REDACTED`;
}

// Re-export for backward compatibility — other modules and tests import
// checkAborted, isValidToolCall, and isLooping from agent.ts. The canonical
// homes are agent-utils.ts and stream-processor.ts.
export { checkAborted, isValidToolCall } from "./agent-utils.js";

// Re-export ProviderConfigs for backward compatibility — tests and other
// modules import it from agent.ts. The canonical home is now provider-cache.ts.
export type { ProviderConfigs } from "./provider-cache.js";

export interface AgentOptions {
	maxIterations?: number;
	systemPrompt?: string;
	verbose?: boolean;
	conversationFile?: string;
	maxContextTokens?: number;
	memoryFile?: string;
	maxMemoryTokens?: number;
	memoryBudgetPercent?: number;
	trackContextUsage?: boolean;
	agentsMdPath?: string;
	thinking?: ThinkingConfig;
	providerConfigs?: ProviderConfigs;
	providerCacheSize?: number;
	skillDirectories?: string[];
	mcpManager?: McpManager | null;
	observability?: ObservabilityConfig;
}

export interface RuntimeConfig {
	model?: string;
	thinking?: ThinkingConfig;
}

export interface ToolExecution {
	name: string;
	status: "running" | "complete" | "error";
	args?: Record<string, unknown>;
	output?: string;
	error?: string;
	summary?: string;
	duration?: number;
	startTime?: number;
}

export interface AgentObservabilityMeta {
	traceId: string;
	latencyMs: number;
	usage?: TokenUsage;
	estimatedCostUsd: number;
}

export interface AgentStreamChunk {
	content: string;
	iterations: number;
	done: boolean;
	toolCalls?: string[];
	toolExecutions?: ToolExecution[];
	contextStats?: ContextStats;
	maxIterationsReached?: boolean;
	/** Observability metadata, present on the final (`done`) chunk. */
	observability?: AgentObservabilityMeta;
}

export interface AgentResponse {
	content: string;
	iterations: number;
	messages: Message[];
}

export interface HealthStatus {
	ready: boolean;
	issues: string[];
	providerCount: number;
	skillCount: number;
	memoryEnabled: boolean;
	mcpServers?: Array<{ name: string; connected: boolean; toolCount: number }>;
}

export interface ShutdownOptions {
	signal?: boolean;
}

export class Agent {
	private _providerCache: ProviderCache;
	private _providerConfigs?: ProviderConfigs;
	private _toolRegistry: ToolRegistry;
	private _maxIterations: number;
	private _systemPrompt: string;
	private _verbose: boolean;
	private _maxContextTokens?: number;
	private _memoryStore?: MemoryStore;
	private _maxMemoryTokens?: number;
	private _memoryBudgetPercent?: number;
	private _trackContextUsage: boolean;
	private _thinking?: ThinkingConfig;
	private _conversationManager!: ConversationManager;
	private _skillManager: SkillManager;
	private _mcpManager?: McpManager;
	private _obsWrapper: AgentObservability;
	private _turnExecutor: TurnExecutor;
	private _debug: DebugLogger;

	constructor(llmClient: LLMClient, toolRegistry: ToolRegistry, options: AgentOptions = {}) {
		this._providerConfigs = options.providerConfigs;
		this._providerCache = new ProviderCache(llmClient, options.providerConfigs, options.providerCacheSize);
		this._toolRegistry = toolRegistry;
		this._maxIterations = options.maxIterations ?? 20;
		this._verbose = options.verbose ?? false;
		this._maxContextTokens = options.maxContextTokens;
		this._maxMemoryTokens = options.maxMemoryTokens;
		this._memoryBudgetPercent = options.memoryBudgetPercent;
		this._trackContextUsage = options.trackContextUsage ?? false;
		this._thinking = options.thinking;
		this._mcpManager = options.mcpManager ?? undefined;
		this._conversationManager = new ConversationManager(options.conversationFile);
		this._obsWrapper = new AgentObservability(options.observability);
		this._turnExecutor = new TurnExecutor(toolRegistry, { verbose: options.verbose });
		this._debug = new DebugLogger(this._verbose);

		let effectiveSystemPrompt =
			options.systemPrompt ??
			"You are a helpful AI assistant with access to tools. Use available tools to help the user. When you have enough information to answer, provide your final response.";

		if (options.agentsMdPath) {
			const agentsMdContent = loadAgentsMd(options.agentsMdPath);
			if (agentsMdContent) {
				effectiveSystemPrompt = `${agentsMdContent}\n\n---\n\n${effectiveSystemPrompt}`;
			}
		}

		this._skillManager = new SkillManager(effectiveSystemPrompt);
		this._skillManager.initialize(options.skillDirectories ?? [], getBuiltinSkillsDir());
		this._systemPrompt = effectiveSystemPrompt;

		if (options.memoryFile) {
			this._memoryStore = new MemoryStore({ filePath: options.memoryFile });
		}
	}

	startChatSession(): void {
		this._conversationManager.startSession();
	}

	async _updateConversationHistory(messages: Message[]): Promise<void> {
		await this._conversationManager.setHistory(messages);
	}

	async *runStream(
		userPrompt: string,
		model: string,
		runtimeConfig?: RuntimeConfig,
		options?: { signal?: AbortSignal }
	): AsyncGenerator<AgentStreamChunk, void, unknown> {
		await this._skillManager.waitForSkills();
		this._systemPrompt = this._skillManager.systemPrompt;

		this._skillManager.clearRestriction();

		const providerName = this._providerCache.getProviderName(runtimeConfig?.model ?? model);
		const effectiveModel = runtimeConfig?.model ?? model;
		const { model: modelName } = parseModelString(effectiveModel);
		const runnerObs = new RunnerObservability(this._obsWrapper, providerName, modelName);
		runnerObs.begin(userPrompt);

		const effectiveThinking = runtimeConfig?.thinking ?? this._thinking;
		const llmClient = this._providerCache.getClientForModel(effectiveModel);

		const conversationFile = this._conversationManager.conversationFile;
		let messages: Message[] = conversationFile
			? await this._conversationManager.loadHistory()
			: this._conversationManager.getHistory();

		const isContinuation = userPrompt === "continue";
		if (isContinuation || messages.length > 0) {
			messages.push({ role: "user", content: userPrompt });
		} else {
			messages = [{ role: "user", content: userPrompt }];
		}

		const ctxResult: PrepareContextResult = await prepareContext({
			systemPrompt: this._systemPrompt,
			userPrompt,
			messages,
			maxContextTokens: this._maxContextTokens,
			memoryStore: this._memoryStore,
			maxMemoryTokens: this._maxMemoryTokens,
			memoryBudgetPercent: this._memoryBudgetPercent,
			wrapRetrieval: () => {
				const { span: retrievalSpan, timer: retrievalTimer } = this._obsWrapper.beginRetrieval();
				return (resultCount: number, error?: unknown) => {
					if (error !== undefined) {
						this._obsWrapper.recordRetrievalError(retrievalSpan, error);
					}
					this._obsWrapper.recordRetrieval(retrievalSpan, retrievalTimer, resultCount);
				};
			},
		});
		messages = ctxResult.messages;
		const memoryTokensUsed = ctxResult.memoryTokensUsed;
		const truncationApplied = ctxResult.truncationApplied;
		const systemTokens = ctxResult.systemTokens;
		const maxContextTokens = ctxResult.stats.maxContextTokens;

		// Filter tools by core set + relevance categories
		const relevantCategories = inferRelevantCategories(userPrompt);
		const filteredRegistryTools = this._toolRegistry
			.list()
			.filter((t) => CORE_TOOLS.has(t.name) || !t.category || relevantCategories.has(t.category));

		const tools = this._skillManager
			.filterTools(
				filteredRegistryTools.map((tool) => ({
					name: tool.name,
					description: tool.description,
					parameters: tool.parameters,
				}))
			)
			.sort((a, b) => a.name.localeCompare(b.name));

		const providerTypeForDetails = detectProvider(effectiveModel);
		this._debug.logRequestDetails({
			providerType: providerTypeForDetails,
			model: effectiveModel,
			providerConfig: this._providerConfigs?.[providerTypeForDetails],
			thinking: effectiveThinking,
			systemPromptLength: this._systemPrompt.length,
			messageCount: messages.length,
			toolCount: tools.length,
			maxContextTokens: this._maxContextTokens,
			memoryCount: this._memoryStore?.count(),
		});

		this._turnExecutor.reset();

		const updateStats = (): ContextStats =>
			buildContextStats({
				systemTokens,
				memoryTokens: memoryTokensUsed,
				messages,
				truncationApplied,
				maxContextTokens,
			});

		// Delegate to StreamProcessor for the main iteration loop
		const processor = new StreamProcessor({
			llmClient,
			model: modelName,
			systemPrompt: this._systemPrompt,
			messages,
			tools,
			thinking: effectiveThinking,
			signal: options?.signal,
			maxIterations: this._maxIterations,
			trackContextUsage: this._trackContextUsage,
			turnExecutor: this._turnExecutor,
			runnerObs,
			debug: this._debug,
			updateStats,
			onSaveHistory: (msgs) => this._updateConversationHistory(msgs),
			userPrompt,
		});

		for await (const chunk of processor.process()) {
			yield chunk;
		}
	}

	async run(userPrompt: string, model: string): Promise<AgentResponse> {
		let fullContent = "";
		let iterations = 0;

		for await (const chunk of this.runStream(userPrompt, model)) {
			if (!chunk.done) {
				fullContent += chunk.content;
			}
			iterations = chunk.iterations;
		}

		return {
			content: fullContent,
			iterations,
			messages: this._conversationManager.getHistory(),
		};
	}

	getSkillRegistry(): Map<string, SkillMetadata> {
		return this._skillManager.getRegistry();
	}

	getMemoryStore(): MemoryStore | undefined {
		return this._memoryStore;
	}

	getToolCount(): number {
		return this._toolRegistry.list().length;
	}

	/** Returns the provider configs the agent was constructed with.
	 *  Used by the `/login` chat command to display connection status. */
	getProviderConfigs(): ProviderConfigs | undefined {
		return this._providerConfigs;
	}

	async getMcpServerStatus(): Promise<Array<{ name: string; connected: boolean; toolCount: number }>> {
		if (this._mcpManager) {
			return this._mcpManager.getServerStatus();
		}
		return [];
	}

	async waitForSkills(): Promise<void> {
		await this._skillManager.waitForSkills();
	}

	async loadSkill(
		skillName: string
	): Promise<{ content: string; wrappedContent: string; allowedTools?: string[] } | null> {
		return this._skillManager.loadSkill(skillName);
	}

	_setSkillRestriction(allowedTools: string[] | undefined): void {
		this._skillManager.setRestriction(allowedTools);
	}

	_clearSkillRestriction(): void {
		this._skillManager.clearRestriction();
	}

	async healthCheck(): Promise<HealthStatus> {
		const issues: string[] = [];

		// The default LLM client is always provided in the constructor, so
		// we only flag an issue when provider configs are explicitly empty.
		if (this._providerConfigs && Object.keys(this._providerConfigs).length === 0) {
			issues.push("Provider configs empty");
		}

		return {
			ready: issues.length === 0,
			issues,
			providerCount: this._providerCache.size,
			skillCount: this._skillManager.count,
			memoryEnabled: !!this._memoryStore,
			mcpServers: this._mcpManager?.getServerStatus() ?? [],
		};
	}

	async shutdown(options?: ShutdownOptions): Promise<void> {
		if (this._memoryStore) {
			this._memoryStore.flush();
		}

		await this._conversationManager.close();

		if (options?.signal !== false) {
			// Remove signal handlers if any were registered
			process.removeAllListeners("SIGTERM");
			process.removeAllListeners("SIGINT");
		}
	}
}
