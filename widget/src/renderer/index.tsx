import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/chatgpt-theme.css";
import "./styles/mode-switcher.css";
import "./styles/n8n-mode.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found: #root");
}

createRoot(root).render(<App />);
