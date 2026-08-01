import { describe, expect, it, vi } from "bun:test";
import { handleReviewCommand } from "../../../src/ui/handlers/review-handler.js";
import { MessageRole } from "../../../src/ui/types/enums.js";

describe("handleReviewCommand", () => {
	it("should show error when config file cannot be read", async () => {
		const onAddMessage = vi.fn();
		await handleReviewCommand({ onAddMessage });

		expect(onAddMessage).toHaveBeenCalledWith(
			MessageRole.ASSISTANT,
			expect.stringContaining("Error: Could not read config file")
		);
	});
});
