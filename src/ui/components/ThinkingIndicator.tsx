import type React from "react";
import { Spinner } from "./Spinner.js";

interface ThinkingIndicatorProps {
	visible: boolean;
}

export function ThinkingIndicator({ visible }: ThinkingIndicatorProps): React.ReactElement | null {
	return <Spinner isLoading={visible} label="Thinking" />;
}
