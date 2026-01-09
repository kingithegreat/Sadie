export type Role = "user" | "assistant" | "system";

export type StreamingState =
  | "streaming"
  | "cancelling"
  | "cancelled"
  | "finished"
  | "error";

export interface ReflectionMeta {
  confidence: number | null;
  accepted: boolean;
  threshold?: number | null;
}

export type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  updatedAt?: number;

  // assistant only
  streamId?: string;
  isStreaming?: boolean;
  streamingState?: StreamingState;
  error?: string | null;
  // NEW: reflection meta
  reflection?: ReflectionMeta;
};

export type StreamChunkPayload = {
  streamId: string;
  chunk: string;
};

export type StreamEndPayload = {
  streamId: string;
  cancelled?: boolean;
};

export type StreamErrorPayload = {
  streamId: string;
  error?: string;
};

export type Settings = {
  model: string;
  temperature: number;
  maxTokens: number;
  n8nUrl?: string;
  openaiEndpoint?: string;
  apiKeys?: Record<string, string>;
};
