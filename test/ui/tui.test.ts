import { describe, expect, it } from "bun:test";
import type { KeyEvent } from "@orchetron/storm";
import { mapStormKeyToInkKey } from "../../src/ui/tui.js";

function createKeyEvent(partial: Partial<KeyEvent>): KeyEvent {
	return {
		key: "",
		char: "",
		raw: "",
		ctrl: false,
		shift: false,
		meta: false,
		...partial,
	};
}

describe("mapStormKeyToInkKey", () => {
	it("maps arrow keys and paging keys", () => {
		expect(mapStormKeyToInkKey(createKeyEvent({ key: "up" })).upArrow).toBe(true);
		expect(mapStormKeyToInkKey(createKeyEvent({ key: "down" })).downArrow).toBe(true);
		expect(mapStormKeyToInkKey(createKeyEvent({ key: "left" })).leftArrow).toBe(true);
		expect(mapStormKeyToInkKey(createKeyEvent({ key: "right" })).rightArrow).toBe(true);
		expect(mapStormKeyToInkKey(createKeyEvent({ key: "pageup" })).pageUp).toBe(true);
		expect(mapStormKeyToInkKey(createKeyEvent({ key: "pagedown" })).pageDown).toBe(true);
	});

	it("maps enter/escape/editing keys and modifier flags", () => {
		const mapped = mapStormKeyToInkKey(
			createKeyEvent({
				key: "return",
				ctrl: true,
				meta: true,
				shift: true,
			})
		);
		expect(mapped.return).toBe(true);
		expect(mapped.ctrl).toBe(true);
		expect(mapped.meta).toBe(true);
		expect(mapped.shift).toBe(true);
		expect(mapStormKeyToInkKey(createKeyEvent({ key: "escape" })).escape).toBe(true);
		expect(mapStormKeyToInkKey(createKeyEvent({ key: "backspace" })).backspace).toBe(true);
		expect(mapStormKeyToInkKey(createKeyEvent({ key: "delete" })).delete).toBe(true);
	});
});
