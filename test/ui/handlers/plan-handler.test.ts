import { afterEach, describe, expect, it, vi } from "bun:test";
import { StateManager } from "../../../src/agents/state-manager.js";
import type { StateFile } from "../../../src/agents/types.js";
import { handlePlanCommand } from "../../../src/ui/handlers/plan-handler.js";
import { MessageRole } from "../../../src/ui/types/enums.js";

function makeState(): StateFile {
	return {
		metadata: {
			agentName: "tiny-agent",
			agentVersion: "1.0.0",
			invocationTimestamp: new Date().toISOString(),
			parameters: {},
		},
		phase: "plan",
		taskDescription: "",
		status: "pending",
		results: {},
		errors: [],
		artifacts: [],
	};
}

describe("handlePlanCommand", () => {
	const loadOrFailSpy = vi.spyOn(StateManager.prototype, "loadOrFail");

	afterEach(() => {
		loadOrFailSpy.mockRestore();
	});

	it("should show error when state file not found", async () => {
		loadOrFailSpy.mockResolvedValue({ success: false, error: "not found", code: "not_found" });
		const onAddMessage = vi.fn();
		await handlePlanCommand("show", { onAddMessage });

		expect(onAddMessage).toHaveBeenCalledWith(MessageRole.ASSISTANT, expect.stringContaining("No state file found"));
	});

	it("should show help for unknown subcommand", async () => {
		loadOrFailSpy.mockResolvedValue({ success: true, state: makeState() });
		const onAddMessage = vi.fn();
		await handlePlanCommand("unknown", { onAddMessage });

		expect(onAddMessage).toHaveBeenCalledWith(
			MessageRole.ASSISTANT,
			expect.stringContaining("Unknown plan subcommand")
		);
	});
});
