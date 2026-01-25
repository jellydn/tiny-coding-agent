import React, { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { type StatusLineState, statusLineManager } from "../status-line-manager.js";
import type { StatusType } from "../types/enums.js";

export type StatusLineStatus = StatusType;

interface StatusLineContextValue extends StatusLineState {
	setStatus: (status?: StatusLineStatus) => void;
	setModel: (model?: string) => void;
	setContext: (used?: number, max?: number) => void;
	setTool: (tool?: string) => void;
	clearTool: () => void;
	setMcpServerCount: (count?: number) => void;
	showStatusLine: boolean;
}

const StatusLineContext = createContext<StatusLineContextValue | null>(null);

export function useStatusLine(): StatusLineContextValue {
	const context = useContext(StatusLineContext);
	if (!context) {
		throw new Error("useStatusLine must be used within a StatusLineProvider");
	}
	return context;
}

interface StatusLineProviderProps {
	children: ReactNode;
}

export function StatusLineProvider({ children }: StatusLineProviderProps): React.ReactElement {
	const [state, setState] = useState<StatusLineState>({});

	useEffect(() => {
		return statusLineManager.subscribe((newState) => {
			setState((prevState) => ({ ...prevState, ...newState }));
		});
	}, []);

	const contextValue = useMemo(
		() => ({
			...state,
			setStatus: statusLineManager.setStatus.bind(statusLineManager),
			setModel: statusLineManager.setModel.bind(statusLineManager),
			setContext: statusLineManager.setContext.bind(statusLineManager),
			setTool: statusLineManager.setTool.bind(statusLineManager),
			clearTool: statusLineManager.clearTool.bind(statusLineManager),
			setMcpServerCount: statusLineManager.setMcpServerCount.bind(statusLineManager),
			showStatusLine: statusLineManager.showStatusLine,
		}),
		[state]
	);

	return <StatusLineContext.Provider value={contextValue}>{children}</StatusLineContext.Provider>;
}
