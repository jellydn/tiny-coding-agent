import React from "react";
import { Text, render } from "ink";

interface AppProps {
  children?: React.ReactNode;
}

/**
 * Root Ink component for the Tiny Agent CLI.
 * Currently serves as a placeholder for potential future use cases
 * where the entire chat session is managed within a single Ink app.
 */
export function App({ children }: AppProps): React.ReactElement {
  return <Text>{children ?? "Tiny Agent"}</Text>;
}

/**
 * Helper to render Ink elements.
 * Useful for future persistent rendering patterns.
 */
export function renderApp(element: React.ReactElement) {
  return render(element);
}
