import React, { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import {
  statusLineManager,
  subscribeToStatusLine,
  type StatusLineState,
} from "../status-line-manager.js";

export type StatusLineStatus = "thinking" | "ready" | "error";

interface StatusLineContextValue extends StatusLineState {
  setStatus: (status?: StatusLineStatus) => void;
  setModel: (model?: string) => void;
  setContext: (used?: number, max?: number) => void;
  setTool: (tool?: string) => void;
  clearTool: () => void;
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
  const [status, setStatusState] = useState<StatusLineStatus | undefined>();
  const [model, setModelState] = useState<string | undefined>();
  const [tokensUsed, setTokensUsedState] = useState<number | undefined>();
  const [tokensMax, setTokensMaxState] = useState<number | undefined>();
  const [tool, setToolState] = useState<string | undefined>();
  const [toolStartTime, setToolStartTimeState] = useState<number | undefined>();
  const [showStatusLine, setShowStatusLineState] = useState(true);

  useEffect(() => {
    return subscribeToStatusLine((newState: StatusLineState) => {
      if ("status" in newState) setStatusState(newState.status);
      if ("model" in newState) setModelState(newState.model);
      if ("tokensUsed" in newState) setTokensUsedState(newState.tokensUsed);
      if ("tokensMax" in newState) setTokensMaxState(newState.tokensMax);
      if ("tool" in newState) setToolState(newState.tool);
      if ("toolStartTime" in newState) setToolStartTimeState(newState.toolStartTime);
      setShowStatusLineState(statusLineManager.showStatusLine);
    });
  }, []);

  const setStatus = (newStatus?: StatusLineStatus) => {
    statusLineManager.setStatus(newStatus);
  };

  const setModel = (newModel?: string) => {
    statusLineManager.setModel(newModel);
  };

  const setContext = (used?: number, max?: number) => {
    statusLineManager.setContext(used, max);
  };

  const setTool = (newTool?: string) => {
    statusLineManager.setTool(newTool);
  };

  const clearTool = () => {
    statusLineManager.clearTool();
  };

  return (
    <StatusLineContext.Provider
      value={{
        status,
        model,
        tokensUsed,
        tokensMax,
        tool,
        toolStartTime,
        setStatus,
        setModel,
        setContext,
        setTool,
        clearTool,
        showStatusLine,
      }}
    >
      {children}
    </StatusLineContext.Provider>
  );
}
