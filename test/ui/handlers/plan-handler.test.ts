import { describe, expect, it, vi } from "bun:test";
import { handlePlanCommand } from "../../../src/ui/handlers/plan-handler.js";
import { MessageRole } from "../../../src/ui/types/enums.js";

describe("handlePlanCommand", () => {
	it("should show error when state file not found", async () => {
		const onAddMessage = vi.fn();
		await handlePlanCommand("show", { onAddMessage });

		expect(onAddMessage).toHaveBeenCalledWith(MessageRole.ASSISTANT, expect.stringContaining("No state file found"));
	});

	it("should show help for unknown subcommand", async () => {
		const onAddMessage = vi.fn();
		await handlePlanCommand("unknown", { onAddMessage });

		expect(onAddMessage).toHaveBeenCalledWith(
			MessageRole.ASSISTANT,
			expect.stringContaining("Unknown plan subcommand")
		);
	});
});
