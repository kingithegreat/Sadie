export type Role = "user" | "assistant" | "system";

export type StreamingState =
  | "streaming"
  | "cancelling"
  | "cancelled"
  | "finished"
  | "error";

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
