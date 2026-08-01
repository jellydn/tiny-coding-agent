import { describe, expect, it, vi } from "bun:test";
import { handlePlanCommand } from "../../../src/ui/handlers/plan-handler.js";
import { MessageRole } from "../../../src/ui/types/enums.js";

// Mock the DEFAULT_STATE_FILE to point to a non-existent path
const loadOrFailMock = vi.fn();
vi.mock("../../../src/agents/state-manager.js", () => ({
	DEFAULT_STATE_FILE: "/tmp/nonexistent-state-test.json",
	StateManager: class {
		async loadOrFail() {
			return loadOrFailMock();
		}
		getPlan() {
			return null;
		}
		getBuildSteps() {
			return [];
		}
	},
}));

describe("handlePlanCommand", () => {
	it("should show error when state file not found", async () => {
		loadOrFailMock.mockResolvedValue({ success: false, error: "not found" });
		const onAddMessage = vi.fn();
		await handlePlanCommand("show", { onAddMessage });

		expect(onAddMessage).toHaveBeenCalledWith(MessageRole.ASSISTANT, expect.stringContaining("No state file found"));
	});

	it("should show help for unknown subcommand", async () => {
		loadOrFailMock.mockResolvedValue({ success: true });
		const onAddMessage = vi.fn();
		await handlePlanCommand("unknown", { onAddMessage });

		expect(onAddMessage).toHaveBeenCalledWith(
			MessageRole.ASSISTANT,
			expect.stringContaining("Unknown plan subcommand")
		);
	});
});
