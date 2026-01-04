// src/renderer/components/AutomationCenter.tsx
import React, { useState } from "react";
import { useAutomation } from "../hooks/useAutomation";

type AutomationTab = "file" | "system" | "archive";

export const AutomationCenter: React.FC = () => {
  const [activeTab, setActiveTab] = useState<AutomationTab>("file");
  const { loading, lastResult, lastError, execute } = useAutomation();

  const handleTestClick = () => {
    if (activeTab === "file") {
      void execute({
        domain: "file",
        action: "list",
        payload: { path: "C:\\Temp" }, // demo path – adjust
      });
    } else if (activeTab === "system") {
      void execute({
        domain: "system",
        action: "all",
        payload: {},
      });
    } else if (activeTab === "archive") {
      void execute({
        domain: "archive",
        action: "list",
        payload: { archivePath: "C:\\Temp\\test.zip" },
      });
    }
  };

  return (
    <div className="automation-center">
      <header className="automation-header">
        <h1>Automation Control Center</h1>
        <p>Backed by n8n + Phase 6 PowerShell safety layer</p>
      </header>

      <nav className="automation-tabs">
        <button
          className={activeTab === "file" ? "active" : ""}
          onClick={() => setActiveTab("file")}
        >
          File Manager
        </button>
        <button
          className={activeTab === "system" ? "active" : ""}
          onClick={() => setActiveTab("system")}
        >
          System Info
        </button>
        <button
          className={activeTab === "archive" ? "active" : ""}
          onClick={() => setActiveTab("archive")}
        >
          Archive Ops
        </button>
      </nav>

      <section className="automation-actions">
        <button onClick={handleTestClick} disabled={loading}>
          {loading ? "Running…" : "Run Test Operation"}
        </button>
      </section>

      <section className="automation-status">
        {lastError && (
          <div className="status-banner status-error">
            <strong>Error:</strong> {lastError}
          </div>
        )}

        {lastResult && (
          <div
            className={`status-banner ${
              lastResult.status === "success" ? "status-success" : "status-warning"
            }`}
          >
            <div>
              <strong>Operation:</strong> {lastResult.operation}
            </div>
            <div>
              <strong>Status:</strong> {lastResult.status}
            </div>
            <div>
              <strong>Timestamp:</strong> {lastResult.timestamp}
            </div>
            {lastResult.validation && (
              <div>
                <strong>Validation:</strong>{" "}
                {lastResult.validation.validated ? "PASSED" : "FAILED"}{" "}
                {lastResult.validation.policy
                  ? `(${lastResult.validation.policy})`
                  : ""}
              </div>
            )}
          </div>
        )}

        {lastResult?.data ? (
          <div className="automation-result">
            {typeof lastResult.data === 'string' 
              ? <span>{lastResult.data as string}</span>
              : <pre>{JSON.stringify(lastResult.data, null, 2)}</pre>}
          </div>
        ) : null}
      </section>
    </div>
  );
};