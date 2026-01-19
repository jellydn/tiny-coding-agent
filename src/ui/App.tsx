import React from "react";
import { Box, render } from "ink";
import { shouldUseInk } from "./utils.js";
import { StatusLineProvider, useStatusLine } from "./contexts/StatusLineContext.js";
import { StatusLine } from "./components/StatusLine.js";

interface StatusLineWrapperProps {
  children?: React.ReactNode;
}

function StatusLineWrapper({ children }: StatusLineWrapperProps): React.ReactElement {
  const context = useStatusLine();
  const showStatusLine =
    shouldUseInk() &&
    (context.status !== undefined ||
      context.model !== undefined ||
      context.tokensUsed !== undefined ||
      context.tool !== undefined);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexGrow={1}>{children}</Box>
      {showStatusLine && <StatusLine {...context} />}
    </Box>
  );
}

interface AppProps {
  children?: React.ReactNode;
}

export function App({ children }: AppProps): React.ReactElement {
  return (
    <StatusLineProvider>
      <StatusLineWrapper>{children ?? "Tiny Agent"}</StatusLineWrapper>
    </StatusLineProvider>
  );
}

export function renderApp(element: React.ReactElement) {
  return render(element);
}
