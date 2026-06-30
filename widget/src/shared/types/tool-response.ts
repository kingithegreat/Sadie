// HomeBot Tool Response Envelope Types

export interface HomeBotToolResponse<T = unknown> {
  success: boolean;
  tool: string;
  requestId: string;
  durationMs: number;
  result: T;
  error: {
    code: string;
    message: string;
    retryable: boolean;
  } | null;
}

// Add these specific result types
export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface FileManagerResult {
  operation: string;
  path: string;
  content?: string;
  entries?: string[];
}

export interface SystemInfoResult {
  infoType: string;
  data: Record<string, unknown>;
}

// Concrete response types for each tool
export type HomeBotWebSearchResponse = HomeBotToolResponse<WebSearchResult[]>;
export type HomeBotFileManagerResponse = HomeBotToolResponse<FileManagerResult>;
export type HomeBotSystemInfoResponse = HomeBotToolResponse<SystemInfoResult>;
