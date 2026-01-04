// src/renderer/hooks/useAutomation.ts
import { useCallback, useState } from "react";

type AutomationDomain = "file" | "system" | "archive";

interface AutomationRequest {
  domain: AutomationDomain;
  action: string;
  payload?: Record<string, unknown>;
}

interface AutomationResponse<TData = unknown> {
  status: "success" | "failure";
  operation: string;
  timestamp: string;
  data: TData;
  validation?: {
    validated: boolean;
    policy?: string;
    details?: unknown;
  };
  error?: {
    message: string;
    code?: string;
    details?: unknown;
  };
}

interface IpcAutomationResult<T = unknown> {
  ok: boolean;
  result?: AutomationResponse<T>;
  error?: {
    message: string;
    stack?: string;
  };
}

interface UseAutomationState<T = unknown> {
  loading: boolean;
  lastResult?: AutomationResponse<T>;
  lastError?: string;
  execute: (request: AutomationRequest) => Promise<void>;
}

export function useAutomation<T = unknown>(): UseAutomationState<T> {
  const [loading, setLoading] = useState(false);
  const [lastResult, setLastResult] = useState<AutomationResponse<T>>();
  const [lastError, setLastError] = useState<string>();

  const execute = useCallback(async (request: AutomationRequest) => {
    setLoading(true);
    setLastError(undefined);

    try {
      const res = await window.electron.executeAutomation!(
        `${request.domain}:${request.action}`,
        request.payload
      );

      if (!res.success) {
        setLastResult(undefined);
        setLastError(res.error ?? "Unknown automation error");
        return;
      }

      // The result should be an AutomationResponse
      const automationResult = res.result as AutomationResponse<T>;
      setLastResult(automationResult);

      if (automationResult.status === "failure") {
        setLastError(automationResult.error?.message ?? "Operation failed");
      }
    } catch (error) {
      setLastResult(undefined);
      setLastError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    loading,
    lastResult,
    lastError,
    execute,
  };
}