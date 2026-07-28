/**
 * Agent LLM Client Factory — eliminates the 3-way duplication of
 * loadConfig → parseModelString → createProvider across plan-agent,
 * explore-agent, and build-agent.
 *
 * Each agent had the same ~5-line sequence:
 *   const config = loadConfig();
 *   const modelString = config.defaultModel;
 *   const { model: modelName } = parseModelString(modelString);
 *   const client = createProvider({ model: modelString, ... });
 *
 * This module concentrates that into one function with a clean interface.
 */

import { loadConfig } from "../config/loader.js";
import type { Config } from "../config/schema.js";
import { createProvider, parseModelString } from "../providers/factory.js";
import type { LLMClient } from "../providers/types.js";

export interface AgentClientResult {
	/** The LLM client ready for chat() calls. */
	client: LLMClient;
	/** The parsed model name (without provider prefix) for API calls. */
	modelName: string;
	/** The full model string (with provider prefix) from config. */
	modelString: string;
	/** The loaded config (for additional fields if needed). */
	config: Config;
}

/**
 * Create an LLM client from the default config, ready for use by the
 * plan/explore/build agents.
 *
 * @param modelOverride — optional model override (e.g. from CLI --model flag)
 * @returns { client, modelName, modelString, config }
 */
export async function createAgentClient(modelOverride?: string): Promise<AgentClientResult> {
	const config = loadConfig();
	const modelString = modelOverride ?? config.defaultModel;
	const { model: modelName } = parseModelString(modelString);

	const client = createProvider({
		model: modelString,
		provider: undefined,
		providers: config.providers,
	});

	return { client, modelName, modelString, config };
}
