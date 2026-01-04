// src/main/n8n-client.ts
import { URL } from "node:url";

export type AutomationDomain = "file" | "system" | "archive";

export interface AutomationRequest {
  domain: AutomationDomain;
  action: string;
  payload?: Record<string, unknown>;
}

export interface AutomationResponse<TData = unknown> {
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

export class N8nClient {
  private baseUrl: string;
  private apiKey?: string;

  constructor(baseUrl: string, apiKey?: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
  }

  private getEndpointForDomain(domain: AutomationDomain): string {
    switch (domain) {
      case "file":
        return "/webhook/file-manager";      // or /rest/… depending on your n8n setup
      case "system":
        return "/webhook/system-info";
      case "archive":
        return "/webhook/archive-ops";
      default:
        throw new Error(`Unsupported automation domain: ${domain satisfies never}`);
    }
  }

  async execute<T = unknown>(request: AutomationRequest): Promise<AutomationResponse<T>> {
    const endpoint = this.getEndpointForDomain(request.domain);
    const url = new URL(endpoint, this.baseUrl).toString();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.apiKey) {
      headers["X-API-Key"] = this.apiKey;
    }

    const body = JSON.stringify({
      action: request.action,
      payload: request.payload ?? {},
    });

    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `n8n request failed with status ${res.status}: ${text || res.statusText}`,
      );
    }

    const json = (await res.json()) as AutomationResponse<T>;

    // Minimal contract sanity check – your scripts already enforce structure
    if (!json || !json.status || !json.operation || !json.timestamp) {
      throw new Error("Invalid automation response structure from n8n");
    }

    return json;
  }
}