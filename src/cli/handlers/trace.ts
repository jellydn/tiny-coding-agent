/**
 * `tiny-agent trace <prompt>` — demo command for AI observability.
 *
 * Runs a single prompt through the agent and prints the observability
 * metadata: trace ID, latency, token counts, and estimated cost. Use `--mock`
 * to run against an in-memory provider (no API key required) so the demo is
 * always runnable.
 */
import type { Config } from "../../config/schema.js";
import { Agent, type AgentObservabilityMeta } from "../../core/agent.js";
import { flushLangfuse, isLangfuseEnabled } from "../../observability/langfuse.js";
import { shutdownTelemetry } from "../../observability/telemetry.js";
import type { ChatOptions, ChatResponse, LLMClient, StreamChunk } from "../../providers/types.js";
import { type CliOptions, createLLMClient, setupTools } from "../shared.js";

/**
 * An in-memory LLM client that returns a canned response with token usage,
 * so the trace demo works without any API key.
 */
class MockObservabilityClient implements LLMClient {
	async chat(_options: ChatOptions): Promise<ChatResponse> {
		return {
			content: "This is a mocked response for the observability demo.",
			finishReason: "stop",
			usage: { inputTokens: 42, outputTokens: 18, totalTokens: 60 },
		};
	}

	async *stream(_options: ChatOptions): AsyncGenerator<StreamChunk, void, unknown> {
		yield { content: "This is a mocked response ", done: false };
		yield { content: "for the observability demo.", done: false };
		yield {
			done: true,
			usage: { inputTokens: 42, outputTokens: 18, totalTokens: 60, cachedTokens: 10 },
		};
	}

	async getCapabilities(model: string) {
		return {
			modelName: model,
			supportsTools: true,
			supportsStreaming: true,
			supportsSystemPrompt: true,
			supportsToolStreaming: true,
			supportsThinking: false,
			contextWindow: 32000,
			maxOutputTokens: 4096,
			isVerified: false,
			source: "fallback" as const,
		};
	}
}

function formatMeta(meta: AgentObservabilityMeta): string {
	const lines: string[] = [];
	lines.push("\n📊 Observability");
	lines.push("===============\n");
	lines.push(`  Trace ID:        ${meta.traceId}`);
	lines.push(`  Latency:         ${meta.latencyMs} ms`);
	if (meta.usage) {
		const u = meta.usage;
		lines.push(`  Input tokens:    ${u.inputTokens ?? "unavailable"}`);
		lines.push(`  Output tokens:   ${u.outputTokens ?? "unavailable"}`);
		lines.push(`  Total tokens:    ${u.totalTokens ?? "unavailable"}`);
		if (u.cachedTokens !== undefined) lines.push(`  Cached tokens:   ${u.cachedTokens}`);
		if (u.reasoningTokens !== undefined) lines.push(`  Reasoning tokens:${u.reasoningTokens}`);
	} else {
		lines.push("  Token usage:     unavailable (provider returned no usage data)");
	}
	lines.push(`  Estimated cost:  $${meta.estimatedCostUsd.toFixed(6)} USD (estimate)`);
	if (isLangfuseEnabled()) {
		lines.push("  Langfuse:        enabled");
	}
	lines.push("");
	return lines.join("\n");
}

export async function handleTrace(config: Config, args: string[], options: CliOptions): Promise<void> {
	const prompt = args.join(" ").trim();
	if (!prompt) {
		console.error("Error: trace command requires a prompt (use --mock to skip API keys)");
		console.error('Example: tiny-agent trace --mock "explain observability"');
		process.exit(1);
	}

	const useMock = options.mock ?? false;
	const model = options.model || config.defaultModel;

	const llmClient: LLMClient = useMock ? new MockObservabilityClient() : await createLLMClient(config, options);
	const { registry: toolRegistry } = await setupTools(config);

	const agent = new Agent(llmClient, toolRegistry, {
		verbose: options.verbose,
		systemPrompt: config.systemPrompt,
		maxContextTokens: config.maxContextTokens,
		trackContextUsage: !options.noTrackContext,
		thinking: config.thinking,
		providerConfigs: config.providers,
		observability: config.observability,
	});

	if (!options.json) {
		console.log(`\n🔄 Running trace demo (model: ${model}, provider: ${useMock ? "mock" : "configured"})\n`);
	}

	let meta: AgentObservabilityMeta | undefined;
	let content = "";

	try {
		for await (const chunk of agent.runStream(prompt, model)) {
			if (chunk.content && !options.json) {
				process.stdout.write(chunk.content);
			}
			content += chunk.content;
			if (chunk.done && chunk.observability) {
				meta = chunk.observability;
			}
		}

		if (meta) {
			if (options.json) {
				console.log(JSON.stringify({ data: { content }, meta }, null, 2));
			} else {
				process.stdout.write("\n");
				console.log(formatMeta(meta));
			}
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`\nError: ${message}`);
		process.exit(1);
	} finally {
		await flushLangfuse();
		await shutdownTelemetry();
	}

	process.exit(0);
}
