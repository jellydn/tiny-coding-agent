import { afterEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import { handleReviewCommand } from "../../../src/ui/handlers/review-handler.js";
import { MessageRole } from "../../../src/ui/types/enums.js";

describe("handleReviewCommand", () => {
	const readFileSpy = vi.spyOn(fs, "readFile");

	afterEach(() => {
		readFileSpy.mockRestore();
	});

	it("should show error when config file cannot be read", async () => {
		readFileSpy.mockRejectedValue(new Error("ENOENT: no such file or directory"));

		const onAddMessage = vi.fn();
		await handleReviewCommand({ onAddMessage });

		expect(onAddMessage).toHaveBeenCalledWith(
			MessageRole.ASSISTANT,
			expect.stringContaining("Error: Could not read config file")
		);
	});
});
