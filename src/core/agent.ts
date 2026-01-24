import type { LLMClient, Message } from "../providers/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolDefinition } from "../providers/types.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { countTokens, truncateMessages } from "./tokens.js";
import { escapeXml } from "../utils/xml.js";
import {
  MemoryStore,
  calculateContextBudget,
  buildContextWithMemory,
  type ContextStats,
} from "./memory.js";
import { loadAgentsMd } from "../config/loader.js";
import type { ThinkingConfig, ProviderConfig } from "../config/schema.js";
import { createProvider, detectProvider } from "../providers/factory.js";
import {
  discoverSkills,
  generateSkillsPrompt,
  getBuiltinSkillsDir,
  type SkillMetadata,
} from "../skills/index.js";
import { parseSkillFrontmatter } from "../skills/parser.js";
import { getEmbeddedSkillContent } from "../skills/builtin-registry.js";
import { ConversationManager } from "./conversation.js";

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

function isValidToolCall(text: string): boolean {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && typeof parsed.name === "string";
  } catch {
    return false;
  }
}

export class Agent {
  private _defaultLlmClient: LLMClient;
  private _providerConfigs?: ProviderConfigs;
  private _providerCache: Map<string, LLMClient> = new Map();
  private _toolRegistry: ToolRegistry;
  private _maxIterations: number;
  private _systemPrompt: string;
  private _verbose: boolean;
  private _maxContextTokens?: number;
  private _memoryStore?: MemoryStore;
  private _maxMemoryTokens?: number;
  private _trackContextUsage: boolean;
  private _thinking?: ThinkingConfig;
  private _conversationManager!: ConversationManager;
  private _skills: Map<string, SkillMetadata> = new Map();
  private _skillsInitialized: boolean = false;
  private _skillsInitPromise?: Promise<void>;
  private _activeSkillAllowedTools: string[] | undefined;

  constructor(llmClient: LLMClient, toolRegistry: ToolRegistry, options: AgentOptions = {}) {
    this._defaultLlmClient = llmClient;
    this._providerConfigs = options.providerConfigs;
    this._toolRegistry = toolRegistry;
    this._maxIterations = options.maxIterations ?? 20;
    this._verbose = options.verbose ?? false;
    this._maxContextTokens = options.maxContextTokens;
    this._maxMemoryTokens = options.maxMemoryTokens;
    this._trackContextUsage = options.trackContextUsage ?? false;
    this._thinking = options.thinking;
    this._conversationManager = new ConversationManager(options.conversationFile);

    let effectiveSystemPrompt =
      options.systemPrompt ??
      "You are a helpful AI assistant with access to tools. Use available tools to help the user. When you have enough information to answer, provide your final response.";

    if (options.agentsMdPath) {
      const agentsMdContent = loadAgentsMd(options.agentsMdPath);
      if (agentsMdContent) {
        effectiveSystemPrompt = `${agentsMdContent}\n\n---\n\n${effectiveSystemPrompt}`;
        if (this._verbose) {
          console.log(`[Loaded AGENTS.md from ${options.agentsMdPath}]`);
        }
      }
    }

    this._systemPrompt = effectiveSystemPrompt;

    this._skillsInitPromise = this._initializeSkills(
      options.skillDirectories ?? [],
      getBuiltinSkillsDir(),
      effectiveSystemPrompt,
      this._verbose,
    );

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
    this._conversationManager.startSession();
  }

  _updateConversationHistory(messages: Message[]): void {
    this._conversationManager.setHistory(messages);
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

    const conversationFile = this._conversationManager.conversationFile;
    let messages: Message[] = conversationFile
      ? this._conversationManager.loadHistory()
      : this._conversationManager.getHistory();

    const isContinuation = userPrompt === "continue";
    if (isContinuation || messages.length > 0) {
      messages.push({ role: "user", content: userPrompt });
    } else {
      messages = [{ role: "user", content: userPrompt }];
    }

    let contextStats: ContextStats | undefined;
    let memoryTokensUsed = 0;
    let truncationApplied = false;

    const systemTokens = countTokens(this._systemPrompt);

    const makeContextStats = (memTokens: number, trunc: boolean): ContextStats => {
      const convTokens = messages.reduce((sum, msg) => sum + countTokens(msg.content), 0);
      const stats: ContextStats = {
        systemPromptTokens: systemTokens,
        memoryTokens: memTokens,
        conversationTokens: convTokens,
        totalTokens: systemTokens + memTokens + convTokens,
        maxContextTokens: this._maxContextTokens ?? 0,
        truncationApplied: trunc,
        memoryCount: 0,
      };
      return stats;
    };

    if (!this._maxContextTokens) {
      // No context limit - track stats for display only
      const conversationTokens = messages.reduce((sum, msg) => sum + countTokens(msg.content), 0);
      contextStats = {
        systemPromptTokens: systemTokens,
        memoryTokens: 0,
        conversationTokens,
        totalTokens: systemTokens + conversationTokens,
        maxContextTokens: 0,
        truncationApplied: false,
        memoryCount: 0,
      };
    } else if (this._memoryStore) {
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
    } else {
      // No memory store but has max context - truncate messages
      const availableTokens = this._maxContextTokens - systemTokens - 1000;
      if (availableTokens <= 0) {
        truncationApplied = false;
      } else {
        const truncated = truncateMessages(messages, availableTokens);
        truncationApplied = truncated.length < messages.length;
        if (truncationApplied) messages = truncated as Message[];
      }
      contextStats = {
        systemPromptTokens: systemTokens,
        memoryTokens: 0,
        conversationTokens: messages.reduce((sum, msg) => sum + countTokens(msg.content), 0),
        totalTokens: systemTokens + (messages.reduce((sum, msg) => sum + countTokens(msg.content), 0)),
        maxContextTokens: this._maxContextTokens,
        truncationApplied,
        memoryCount: 0,
      };
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
      console.log(`  maxContextTokens: ${this._maxContextTokens}`);
      if (this._memoryStore) {
        console.log(`  Memory: ${this._memoryStore.count()} memories stored`);
      }
      console.log("");
    }

    let iteration = 0;
    const recentToolCalls: string[] = [];
    let loopDetected = false;

    for (iteration = 0; iteration < this._maxIterations; iteration++) {
      if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");

      if (!contextStats) {
        contextStats = {
          systemPromptTokens: countTokens(this._systemPrompt),
          memoryTokens: memoryTokensUsed,
          conversationTokens: messages.reduce((sum, msg) => sum + countTokens(msg.content), 0),
          totalTokens: 0,
          maxContextTokens: this._maxContextTokens ?? 0,
          truncationApplied,
          memoryCount: 0,
        };
        contextStats.totalTokens =
          contextStats.systemPromptTokens + contextStats.memoryTokens + contextStats.conversationTokens;
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

      if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");

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

      if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");

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
      const declinedErrors = toolExecutionResults.filter(
        ({ result }) => !result.success && result.error?.includes("User declined confirmation"),
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
        contextStats = {
          systemPromptTokens: countTokens(this._systemPrompt),
          memoryTokens: memoryTokensUsed,
          conversationTokens: messages.reduce((sum, msg) => sum + countTokens(msg.content), 0),
          totalTokens: 0,
          maxContextTokens: this._maxContextTokens ?? 0,
          truncationApplied,
          memoryCount: 0,
        };
        contextStats.totalTokens =
          contextStats.systemPromptTokens + contextStats.memoryTokens + contextStats.conversationTokens;
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

      contextStats = {
        systemPromptTokens: countTokens(this._systemPrompt),
        memoryTokens: memoryTokensUsed,
        conversationTokens: messages.reduce((sum, msg) => sum + countTokens(msg.content), 0),
        totalTokens: 0,
        maxContextTokens: this._maxContextTokens ?? 0,
        truncationApplied,
        memoryCount: 0,
      };
      contextStats.totalTokens =
        contextStats.systemPromptTokens + contextStats.memoryTokens + contextStats.conversationTokens;
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
            contextStats: makeContextStats(memoryTokensUsed, truncationApplied),
          };
        }
      }

      this._updateConversationHistory(messages);
      yield {
        content: "",
        iterations: iteration + 1,
        done: true,
        contextStats: makeContextStats(memoryTokensUsed, truncationApplied),
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
      contextStats: makeContextStats(memoryTokensUsed, truncationApplied),
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
      messages: this._conversationManager.getHistory(),
    };
  }

  getSkillRegistry(): Map<string, SkillMetadata> {
    return this._skills;
  }

  getMemoryStore(): MemoryStore | undefined {
    return this._memoryStore;
  }

  async waitForSkills(): Promise<void> {
    if (!this._skillsInitPromise) return;
    await this._skillsInitPromise;
  }

  async loadSkill(
    skillName: string,
  ): Promise<{ content: string; wrappedContent: string; allowedTools?: string[] } | null> {
    const skillMetadata = this._skills.get(skillName);
    if (!skillMetadata) return null;

    try {
      let content: string;
      let baseDir = ".";

      if (skillMetadata.location.startsWith("builtin://")) {
        const embeddedContent = getEmbeddedSkillContent(skillName);
        if (!embeddedContent) {
          throw new Error(`Built-in skill content not found: ${skillName}`);
        }
        content = embeddedContent;
      } else {
        content = await fs.readFile(skillMetadata.location, "utf-8");
        baseDir = path.dirname(skillMetadata.location);
      }

      let allowedTools: string[] | undefined;
      try {
        const parsed = parseSkillFrontmatter(content);
        allowedTools = parsed.frontmatter.allowedTools;
      } catch {
        console.warn(`[WARN] Could not parse frontmatter for skill: ${skillName}`);
      }

      if (allowedTools) {
        this._setSkillRestriction(allowedTools);
      } else {
        this._clearSkillRestriction();
      }

      const escapedContent = escapeXml(content);
      const wrappedContent = `<loaded_skill name="${skillName}" base_dir="${baseDir}">\n${escapedContent}\n</loaded_skill>`;

      return { content, wrappedContent, allowedTools };
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        throw new Error(`Skill file not found: ${skillMetadata.location}`);
      }
      throw new Error(`Error reading skill: ${error.message}`);
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
