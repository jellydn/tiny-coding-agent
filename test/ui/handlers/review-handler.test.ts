import { afterEach, describe, expect, it, vi } from "bun:test";
import * as configIo from "../../../src/config/config-io.js";
import { handleReviewCommand } from "../../../src/ui/handlers/review-handler.js";
import { MessageRole } from "../../../src/ui/types/enums.js";

describe("handleReviewCommand", () => {
	const readConfigFileSpy = vi.spyOn(configIo, "readConfigFile");

	afterEach(() => {
		readConfigFileSpy.mockRestore();
	});

	it("should show error when config file cannot be read", async () => {
		readConfigFileSpy.mockRejectedValue(new Error("ENOENT: no such file or directory"));

		const onAddMessage = vi.fn();
		await handleReviewCommand({ onAddMessage });

		expect(onAddMessage).toHaveBeenCalledWith(
			MessageRole.ASSISTANT,
			expect.stringContaining("Error: Could not read config file")
		);
	});
});
