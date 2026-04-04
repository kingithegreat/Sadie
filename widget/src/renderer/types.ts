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
  bookmarked?: boolean;

  // user only — image attachment previews (url = objectURL or dataURL, renderer-only)
  images?: Array<{ url: string; filename?: string }>;

  // assistant only
  streamId?: string;
  streamingState?: StreamingState;
  error?: string | null;
  durationMs?: number;
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
};
