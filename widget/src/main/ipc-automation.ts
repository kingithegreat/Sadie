// src/main/ipc-automation.ts
import { ipcMain } from "electron";
import { AutomationRequest, AutomationResponse, N8nClient } from "./n8n-client";

interface IpcAutomationResult<T = unknown> {
  ok: boolean;
  result?: AutomationResponse<T>;
  error?: {
    message: string;
    stack?: string;
  };
}

export function registerAutomationIpc(n8nBaseUrl: string, apiKey?: string) {
  const client = new N8nClient(n8nBaseUrl, apiKey);

  ipcMain.handle(
    "automation:execute",
    async (_event, request: AutomationRequest): Promise<IpcAutomationResult> => {
      try {
        const result = await client.execute(request);
        return { ok: true, result };
      } catch (err) {
        const error = err as Error;
        console.error("[automation:execute] failed", error);
        return {
          ok: false,
          error: {
            message: error.message,
            stack: error.stack,
          },
        };
      }
    },
  );
}