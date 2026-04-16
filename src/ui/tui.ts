import {
	Box,
	type KeyEvent,
	render,
	Spinner,
	Text,
	type UseInputOptions,
	useStdout,
	useInput as useStormInput,
} from "@orchetron/storm";

export { Box, render, Spinner, Text, useStdout };

export interface Key {
	downArrow?: boolean;
	upArrow?: boolean;
	leftArrow?: boolean;
	rightArrow?: boolean;
	return?: boolean;
	escape?: boolean;
	pageUp?: boolean;
	pageDown?: boolean;
	backspace?: boolean;
	delete?: boolean;
	ctrl?: boolean;
	meta?: boolean;
	shift?: boolean;
}

export function mapStormKeyToInkKey(event: KeyEvent): Key {
	return {
		downArrow: event.key === "down",
		upArrow: event.key === "up",
		leftArrow: event.key === "left",
		rightArrow: event.key === "right",
		return: event.key === "return",
		escape: event.key === "escape",
		pageUp: event.key === "pageup",
		pageDown: event.key === "pagedown",
		backspace: event.key === "backspace",
		delete: event.key === "delete",
		ctrl: event.ctrl,
		meta: event.meta,
		shift: event.shift,
	};
}

export function useInput(handler: (input: string, key: Key) => void, options?: UseInputOptions): void {
	useStormInput((event) => {
		handler(event.char, mapStormKeyToInkKey(event));
	}, options);
}
