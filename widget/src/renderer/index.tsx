
import { createRoot } from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import GlobalTooltips from "./tooltips/GlobalTooltips";
import "./styles/chatgpt-theme.css";
import "highlight.js/styles/atom-one-dark.css";
import "./styles/homebot-palette.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found: #root");
}

createRoot(root).render(
  <ErrorBoundary>
    <App />
    <GlobalTooltips />
  </ErrorBoundary>
);
