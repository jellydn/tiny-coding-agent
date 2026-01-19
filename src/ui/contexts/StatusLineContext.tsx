import React, { createContext, useContext, useState, type ReactNode } from "react";

export type StatusLineStatus = "thinking" | "ready" | "error";

interface StatusLineState {
  status?: StatusLineStatus;
  model?: string;
  tokensUsed?: number;
  tokensMax?: number;
  tool?: string;
  toolStartTime?: number;
}

interface StatusLineContextValue extends StatusLineState {
  setStatus: (status?: StatusLineStatus) => void;
  setModel: (model?: string) => void;
  setContext: (used?: number, max?: number) => void;
  setTool: (tool?: string) => void;
  clearTool: () => void;
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
  const [status, setStatus] = useState<StatusLineStatus | undefined>();
  const [model, setModelState] = useState<string | undefined>();
  const [tokensUsed, setTokensUsed] = useState<number | undefined>();
  const [tokensMax, setTokensMax] = useState<number | undefined>();
  const [tool, setToolState] = useState<string | undefined>();
  const [toolStartTime, setToolStartTime] = useState<number | undefined>();

  const setModel = (newModel?: string) => {
    setModelState(newModel);
  };

  const setContext = (used?: number, max?: number) => {
    setTokensUsed(used);
    setTokensMax(max);
  };

  const setTool = (newTool?: string) => {
    if (newTool) {
      setToolState(newTool);
      setToolStartTime(Date.now());
    } else {
      setToolState(undefined);
      setToolStartTime(undefined);
    }
  };

  const clearTool = () => {
    setToolState(undefined);
    setToolStartTime(undefined);
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
      }}
    >
      {children}
    </StatusLineContext.Provider>
  );
}
