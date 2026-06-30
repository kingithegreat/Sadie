
import { createRoot } from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { I18nProvider } from "./i18n";
import "./styles/chatgpt-theme.css";
import "highlight.js/styles/atom-one-dark.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found: #root");
}

createRoot(root).render(
  <ErrorBoundary>
    <I18nProvider>
      <App />
    </I18nProvider>
  </ErrorBoundary>
);
