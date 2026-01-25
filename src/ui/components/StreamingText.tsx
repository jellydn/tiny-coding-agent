import { Text } from "ink";
import type React from "react";
import { useEffect, useState } from "react";

interface StreamingTextProps {
	text: string;
	isStreaming: boolean;
}

export function StreamingText({ text, isStreaming }: StreamingTextProps): React.ReactElement {
	const [showCursor, setShowCursor] = useState(true);

	useEffect(() => {
		if (!isStreaming) {
			setShowCursor(false);
			return;
		}

		const interval = setInterval(() => {
			setShowCursor((prev) => !prev);
		}, 500);

		return () => clearInterval(interval);
	}, [isStreaming]);

	return (
		<Text>
			{text}
			{isStreaming && showCursor && <Text color="cyan">▋</Text>}
		</Text>
	);
}
