import type { LLMClient, Message } from "../providers/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolDefinition } from "../providers/types.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { countTokens, truncateMessages } from "./tokens.js";
import {
  MemoryStore,
  calculateContextBudget,
  buildContextWithMemory,
  type ContextStats,
} from "./memory.js";
import { z } from "zod";
import { loadAgentsMd } from "../config/loader.js";
import type { ThinkingConfig, ProviderConfig } from "../config/schema.js";
import { createProvider, detectProvider } from "../providers/factory.js";
import {
  discoverSkills,
  generateSkillsPrompt,
  getBuiltinSkillsDir,
  type SkillMetadata,
} from "../skills/index.js";

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

function redactApiKey(key?: string): string {
  if (!key) return "(not set)";
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

export interface ProviderConfigs {
  openai?: ProviderConfig;
  anthropic?: ProviderConfig;
  ollama?: ProviderConfig;
  ollamaCloud?: ProviderConfig;
  openrouter?: ProviderConfig;
  opencode?: ProviderConfig;
}

export interface AgentOptions {
  maxIterations?: number;
  systemPrompt?: string;
  verbose?: boolean;
  conversationFile?: string;
  maxContextTokens?: number;
  memoryFile?: string;
  maxMemoryTokens?: number;
  trackContextUsage?: boolean;
  agentsMdPath?: string;
  thinking?: ThinkingConfig;
  providerConfigs?: ProviderConfigs;
  skillDirectories?: string[];
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
}

export interface AgentStreamChunk {
  content: string;
  iterations: number;
  done: boolean;
  toolCalls?: string[];
  toolExecutions?: ToolExecution[];
  contextStats?: ContextStats;
  maxIterationsReached?: boolean;
}

export interface AgentResponse {
  content: string;
  iterations: number;
  messages: Message[];
}

export class Agent {
  private _defaultLlmClient: LLMClient;
  private _providerConfigs?: ProviderConfigs;
  private _providerCache: Map<string, LLMClient> = new Map();
  private _toolRegistry: ToolRegistry;
  private _maxIterations: number;
  private _systemPrompt: string;
  private _verbose: boolean;
  private _conversationFile?: string;
  private _maxContextTokens?: number;
  private _memoryStore?: MemoryStore;
  private _maxMemoryTokens?: number;
  private _trackContextUsage: boolean;
  private _thinking?: ThinkingConfig;
  private _conversationHistory: Message[] = [];
  private _skills: Map<string, SkillMetadata> = new Map();
  private _skillsInitialized: boolean = false;
  private _skillsInitPromise?: Promise<void>;
  private _activeSkillAllowedTools: string[] | undefined;

  constructor(llmClient: LLMClient, toolRegistry: ToolRegistry, options: AgentOptions = {}) {
    this._defaultLlmClient = llmClient;
    this._providerConfigs = options.providerConfigs;
    this._toolRegistry = toolRegistry;
    this._maxIterations = options.maxIterations ?? 20;

    let effectiveSystemPrompt =
      options.systemPrompt ??
      "You are a helpful AI assistant with access to tools. Use available tools to help the user. When you have enough information to answer, provide your final response.";

    if (options.agentsMdPath) {
      const agentsMdContent = loadAgentsMd(options.agentsMdPath);
      if (agentsMdContent) {
        effectiveSystemPrompt = `${agentsMdContent}\n\n---\n\n${effectiveSystemPrompt}`;
        if (options.verbose) {
          console.log(`[Loaded AGENTS.md from ${options.agentsMdPath}]`);
        }
      }
    }

    this._skillsInitPromise = this._initializeSkills(
      options.skillDirectories ?? [],
      getBuiltinSkillsDir(),
      effectiveSystemPrompt,
      options.verbose,
    );

    this._systemPrompt = effectiveSystemPrompt;
    this._verbose = options.verbose ?? false;
    this._conversationFile = options.conversationFile;
    this._maxContextTokens = options.maxContextTokens;
    this._maxMemoryTokens = options.maxMemoryTokens;
    this._trackContextUsage = options.trackContextUsage ?? false;
    this._thinking = options.thinking;

    if (options.memoryFile) {
      this._memoryStore = new MemoryStore({ filePath: options.memoryFile });
    }
  }

  private async _initializeSkills(
    skillDirectories: string[],
    builtinDir: string,
    systemPrompt: string,
    verbose?: boolean,
  ): Promise<void> {
    if (this._skillsInitialized) return;

    const discoveredSkills = await discoverSkills(skillDirectories, builtinDir);
    for (const skill of discoveredSkills) {
      this._skills.set(skill.name, skill);
    }
    const skillsPrompt = generateSkillsPrompt(discoveredSkills);
    if (skillsPrompt) {
      this._systemPrompt = `${systemPrompt}\n\n${skillsPrompt}`;
      if (verbose) {
        console.log(
          `[Loaded ${discoveredSkills.length} skills from ${skillDirectories.length} directories]`,
        );
      }
    }
    this._skillsInitialized = true;
  }

  private _getLlmClientForModel(model: string): LLMClient {
    if (!this._providerConfigs) return this._defaultLlmClient;

    const providerType = detectProvider(model);
    const cached = this._providerCache.get(providerType);
    if (cached) return cached;

    try {
      const client = createProvider({
        model,
        provider: providerType,
        providers: this._providerConfigs,
      });
      this._providerCache.set(providerType, client);
      return client;
    } catch (err) {
      if (this._verbose) console.error(`[Failed to create provider for ${providerType}: ${err}]`);
      return this._defaultLlmClient;
    }
  }

  startChatSession(): void {
    this._conversationHistory = [];
  }

  _updateConversationHistory(messages: Message[]): void {
    this._saveConversation(messages);
    this._conversationHistory = messages;
  }

  async *runStream(
    userPrompt: string,
    model: string,
    runtimeConfig?: RuntimeConfig,
    options?: { signal?: AbortSignal },
  ): AsyncGenerator<AgentStreamChunk, void, unknown> {
    if (this._skillsInitPromise) {
      await this._skillsInitPromise;
    }

    this._clearSkillRestriction();

    const effectiveModel = runtimeConfig?.model ?? model;
    const effectiveThinking = runtimeConfig?.thinking ?? this._thinking;
    const llmClient = this._getLlmClientForModel(effectiveModel);

    let messages: Message[];

    if (this._conversationFile) {
      messages = this._loadConversation();
    } else {
      messages = this._conversationHistory;
    }

    const isContinuation = userPrompt === "continue";
    if (!isContinuation) {
      if (messages.length === 0) {
        messages = [{ role: "user", content: userPrompt }];
      } else {
        messages.push({ role: "user", content: userPrompt });
      }
    }

    const updateContextStats = (memoryTokens: number, truncationApplied: boolean): ContextStats => {
      const systemTokens = countTokens(this._systemPrompt);
      let conversationTokens = 0;
      for (const msg of messages) {
        conversationTokens += countTokens(msg.content);
      }
      return {
        systemPromptTokens: systemTokens,
        memoryTokens,
        conversationTokens,
        totalTokens: systemTokens + memoryTokens + conversationTokens,
        maxContextTokens: this._maxContextTokens ?? 0,
        truncationApplied,
        memoryCount: 0,
      };
    };

    let contextStats: ContextStats | undefined;
    let memoryTokensUsed = 0;
    let truncationApplied = false;

    if (this._maxContextTokens && this._memoryStore) {
      const systemTokens = countTokens(this._systemPrompt);
      const { memoryBudget, conversationBudget } = calculateContextBudget(
        this._maxContextTokens,
        systemTokens,
        this._maxMemoryTokens,
      );

      const relevantMemories = this._memoryStore.findRelevant(userPrompt, 10);
      const result = buildContextWithMemory(
        this._systemPrompt,
        relevantMemories,
        messages,
        memoryBudget,
        conversationBudget,
      );

      messages = result.context as Message[];
      contextStats = result.stats;
      memoryTokensUsed = result.stats.memoryTokens;
      truncationApplied = result.stats.truncationApplied;
    } else if (this._maxContextTokens) {
      const systemTokens = countTokens(this._systemPrompt);
      const availableTokens = this._maxContextTokens - systemTokens - 1000;

      if (availableTokens > 0) {
        const truncated = truncateMessages(messages, availableTokens);
        if (truncated.length < messages.length) {
          messages = truncated as Message[];
          truncationApplied = true;
        }
      }

      contextStats = updateContextStats(0, truncationApplied);
    }

    const tools = this._getToolDefinitions();

    if (this._verbose) {
      const providerType = detectProvider(effectiveModel);
      const providerConfig = this._providerConfigs?.[providerType];

      console.log("\n[LLM Request Details]");
      console.log(`  Provider: ${providerType}`);
      console.log(`  Model: ${effectiveModel}`);
      console.log(`  API Key: ${redactApiKey(providerConfig?.apiKey)}`);
      if (providerConfig?.baseUrl) {
        console.log(`  Base URL: ${providerConfig.baseUrl}`);
      }
      if (effectiveThinking?.enabled) {
        console.log(
          `  Thinking: enabled (effort: ${effectiveThinking.effort ?? "medium"}, budget: ${effectiveThinking.budgetTokens ?? "default"})`,
        );
      }
      console.log(`  System Prompt: ${this._systemPrompt.length} chars`);
      console.log(`  Messages: ${messages.length}`);
      console.log(`  Tools: ${tools.length}`);
      if (this._memoryStore) {
        console.log(`  Memory: ${this._memoryStore.count()} memories stored`);
      }
      console.log("");
    }

    let iteration = 0;
    const recentToolCalls: string[] = [];
    let loopDetected = false;

    for (iteration = 0; iteration < this._maxIterations; iteration++) {
      throwIfAborted(options?.signal);

      if (!contextStats) {
        contextStats = updateContextStats(memoryTokensUsed, truncationApplied);
      }

      if (this._verbose) {
        console.log(`\n[Iteration ${iteration + 1}]`);
        if (this._trackContextUsage) {
          console.log(
            `[Context: ${contextStats.totalTokens}/${contextStats.maxContextTokens} - ` +
              `sys: ${contextStats.systemPromptTokens}t, mem: ${contextStats.memoryTokens}t, ` +
              `conv: ${contextStats.conversationTokens}t]`,
          );
        }
      }

      const stream = llmClient.stream({
        model: effectiveModel,
        messages: [
          {
            role: "system",
            content: this._systemPrompt,
          },
          ...messages,
        ],
        tools: tools.length > 0 ? tools : undefined,
        thinking: effectiveThinking,
        signal: options?.signal,
      });

      let fullContent = "";
      let responseToolCalls: string[] = [];
      const assistantToolCalls: { id: string; name: string; arguments: Record<string, unknown> }[] =
        [];

      const toolCallSchema = z.object({
        name: z.string(),
        parameters: z.record(z.string(), z.unknown()).optional(),
      });

      const isValidToolCall = (text: string): boolean => {
        try {
          const parsed = JSON.parse(text);
          return toolCallSchema.safeParse(parsed).success;
        } catch {
          return false;
        }
      };

      for await (const chunk of stream) {
        if (chunk.content) {
          if (!isValidToolCall(chunk.content)) {
            fullContent += chunk.content;
            yield {
              content: chunk.content,
              iterations: iteration + 1,
              done: false,
              contextStats,
            };
          }
        }

        if (chunk.toolCalls) {
          assistantToolCalls.push(...chunk.toolCalls);
          responseToolCalls = chunk.toolCalls.map((tc) => tc.name);
        }
      }

      if (this._verbose) {
        console.log(`LLM Response: ${fullContent}`);
        if (responseToolCalls.length > 0) {
          console.log(`Tool Calls: ${responseToolCalls.join(", ")}`);
        }
      }

      const assistantMessage: Message = {
        role: "assistant",
        content: fullContent,
      };

      messages.push(assistantMessage);

      if (assistantToolCalls.length > 0) {
        assistantMessage.toolCalls = assistantToolCalls;
      }

      messages.push(assistantMessage);

      if (assistantToolCalls.length === 0) {
        if (this._verbose) {
          console.log(`\nAgent finished after ${iteration + 1} iteration(s)`);
        }

        this._updateConversationHistory(messages);

        yield {
          content: "",
          iterations: iteration + 1,
          done: true,
          contextStats,
        };
        return;
      }

      throwIfAborted(options?.signal);

      yield {
        content: "",
        iterations: iteration + 1,
        done: false,
        toolExecutions: assistantToolCalls.map((tc) => ({
          name: tc.name,
          status: "running" as const,
          args: tc.arguments,
        })),
        contextStats,
      };

      const calls = assistantToolCalls.map((tc) => ({
        name: tc.name,
        args: tc.arguments,
      }));
      const batchResults = await this._toolRegistry.executeBatch(calls);

      const resultMap = new Map(batchResults.map((br) => [br.name, br]));
      const toolExecutionResults = assistantToolCalls.map((tc) => ({
        toolCall: tc,
        result: resultMap.get(tc.name)?.result ?? {
          success: false,
          error: `Tool "${tc.name}" result not found`,
        },
      }));

      yield {
        content: "",
        iterations: iteration + 1,
        done: false,
        toolExecutions: toolExecutionResults.map(({ toolCall, result }) => ({
          name: toolCall?.name,
          status: result.success ? "complete" : "error",
          args: toolCall?.arguments,
          output: result.success ? truncateOutput(result.output) : undefined,
          error: result.error ? truncateOutput(result.error) : undefined,
        })),
        contextStats,
      };

      throwIfAborted(options?.signal);

      for (const { toolCall, result } of toolExecutionResults) {
        const toolCallSignature = `${toolCall?.name}:${JSON.stringify(toolCall?.arguments)}`;
        recentToolCalls.push(toolCallSignature);

        messages.push({
          role: "tool",
          content: result.error || result.output || "(no output)",
          toolCallId: toolCall?.id,
        });
      }

      const notFoundErrors = toolExecutionResults.filter(
        ({ result }) => !result.success && result.error?.includes("not found"),
      );

      if (notFoundErrors.length > 0) {
        const missingTools = notFoundErrors.map(({ toolCall }) => toolCall?.name).join(", ");
        messages.push({
          role: "system",
          content: `ERROR: The following tool(s) are not available: ${missingTools}. Please stop and provide your final answer based on the information you have gathered, or ask the user for alternative approaches.`,
        });
        if (this._verbose) {
          console.log(`\n[WARNING] Tool(s) not found: ${missingTools}, breaking loop`);
        }
        loopDetected = true;
        break;
      }

      const declinedErrors = toolExecutionResults.filter(
        ({ result }) => !result.success && result.error?.includes("User declined confirmation"),
      );

      if (declinedErrors.length > 0) {
        const declinedTools = declinedErrors.map(({ toolCall }) => toolCall?.name).join(", ");

        if (declinedErrors.length === toolExecutionResults.length) {
          messages.push({
            role: "system",
            content: `All tool calls (${declinedTools}) were declined by the user. Provide your final answer now without making any more tool calls.`,
          });
          if (this._verbose) {
            console.log(`\n[INFO] All tools declined: ${declinedTools}, requesting final answer`);
          }
          loopDetected = true;
          break;
        }

        if (this._verbose) {
          console.log(
            `\n[INFO] User declined confirmation: ${declinedTools}, continuing with remaining tools`,
          );
        }
        contextStats = updateContextStats(memoryTokensUsed, truncationApplied);
        continue;
      }

      if (recentToolCalls.length >= 3) {
        const lastThree = recentToolCalls.slice(-3);
        if (lastThree.every((call) => call === lastThree[0])) {
          const toolName = assistantToolCalls[0]?.name ?? "unknown";
          messages.push({
            role: "system",
            content: `STOP: You have called ${toolName} repeatedly with the same arguments. Please stop and use the results you already have, or try a different approach. Provide your final answer now based on the information you have gathered.`,
          });
          if (this._verbose) {
            console.log(`\n[WARNING] Detected tool call loop for ${toolName}, breaking loop`);
          }
          loopDetected = true;
          break;
        }
      }

      contextStats = updateContextStats(memoryTokensUsed, truncationApplied);
    }

    if (loopDetected) {
      if (this._verbose) {
        console.log(`\n[Loop detected - requesting final answer from LLM]`);
      }

      const stream = llmClient.stream({
        model: effectiveModel,
        messages: [
          {
            role: "system",
            content: this._systemPrompt,
          },
          ...messages,
        ],
        tools: undefined,
        thinking: effectiveThinking,
        signal: options?.signal,
      });

      for await (const chunk of stream) {
        if (chunk.content) {
          yield {
            content: chunk.content,
            iterations: iteration + 1,
            done: false,
            contextStats: updateContextStats(memoryTokensUsed, truncationApplied),
          };
        }
      }

      this._updateConversationHistory(messages);
      yield {
        content: "",
        iterations: iteration + 1,
        done: true,
        contextStats: updateContextStats(memoryTokensUsed, truncationApplied),
      };
      return;
    }

    if (this._verbose) {
      console.log(`\n[Agent reached max iterations (${this._maxIterations})]`);
    }

    this._updateConversationHistory(messages);

    yield {
      content: "",
      iterations: iteration,
      done: true,
      maxIterationsReached: true,
      contextStats: updateContextStats(memoryTokensUsed, truncationApplied),
    };
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
      messages: this._conversationHistory,
    };
  }

  getSkillRegistry(): Map<string, SkillMetadata> {
    return this._skills;
  }

  async waitForSkills(): Promise<void> {
    if (this._skillsInitPromise) {
      await this._skillsInitPromise;
    }
  }

  _setSkillRestriction(allowedTools: string[] | undefined): void {
    this._activeSkillAllowedTools = allowedTools;
  }

  _clearSkillRestriction(): void {
    this._activeSkillAllowedTools = undefined;
  }

  private _getToolDefinitions(): ToolDefinition[] {
    const allTools = this._toolRegistry.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as unknown as Record<string, unknown>,
    }));

    if (!this._activeSkillAllowedTools || this._activeSkillAllowedTools.length === 0) {
      return allTools;
    }

    const allowedSet = new Set(this._activeSkillAllowedTools);
    return allTools.filter((tool) => allowedSet.has(tool.name));
  }

  private _loadConversation(): Message[] {
    if (!this._conversationFile || !existsSync(this._conversationFile)) {
      return [];
    }

    try {
      const content = readFileSync(this._conversationFile, "utf-8");
      const data = JSON.parse(content);
      return data.messages || [];
    } catch (err) {
      console.error(`Warning: Failed to load conversation from ${this._conversationFile}: ${err}`);
      return [];
    }
  }

  private _saveConversation(messages: Message[]): void {
    if (!this._conversationFile) {
      return;
    }

    try {
      const data = {
        timestamp: new Date().toISOString(),
        messages,
      };
      writeFileSync(this._conversationFile, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      console.error(`Warning: Failed to save conversation to ${this._conversationFile}: ${err}`);
    }
  }
}

const MAX_OUTPUT_LENGTH = 500;

function truncateOutput(output: string | undefined): string | undefined {
  if (!output) return output;
  const lines = output.split("\n");
  if (lines.length > 10) {
    return `${lines.slice(0, 10).join("\n")}\n... (${lines.length - 10} more lines)`;
  }
  if (output.length > MAX_OUTPUT_LENGTH) {
    return `${output.slice(0, MAX_OUTPUT_LENGTH)}\n... (${output.length - MAX_OUTPUT_LENGTH} more chars)`;
  }
  return output;
}
