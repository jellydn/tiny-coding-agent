import React from "react";
import { Text, render } from "ink";

interface AppProps {
  children?: React.ReactNode;
}

export function App({ children }: AppProps): React.ReactElement {
  return <Text>{children ?? "Tiny Agent"}</Text>;
}

export function renderApp(element: React.ReactElement) {
  return render(element);
}
