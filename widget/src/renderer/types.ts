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
  reactions?: Record<string, number>;
  edited?: boolean;

  // user only — image attachment previews (url = objectURL or dataURL, renderer-only)
  images?: Array<{ url: string; filename?: string }>;

  // assistant only
  streamId?: string;
  streamingState?: StreamingState;
  model?: string;
  error?: string | null;
  recoveryHint?: {
    service: 'ollama' | 'n8n' | 'model' | 'unknown';
    userMessage: string;
    action?: 'start-ollama' | 'pull-model' | 'retry' | 'check-settings' | 'reattach-document';
    actionLabel?: string;
    model?: string;
    /** Set by the main process only when a configured, usable cloud provider
     *  exists — see RecoveryHint in main/message-router.ts. Its presence is the
     *  whole permission to draw the "use the online AI" button; the renderer
     *  must not re-derive it from its own settings copy. */
    cloudFallback?: { provider: string; model: string };
  } | null;
  durationMs?: number;
};

export type StreamChunkPayload = {
  streamId: string;
  chunk: string;
};

export type StreamEndPayload = {
  streamId: string;
  cancelled?: boolean;
  model?: string;
};

export type StreamErrorPayload = {
  streamId: string;
  error?: string;
  message?: string;
  recoveryHint?: ChatMessage['recoveryHint'];
};

export type Settings = {
  model: string;
  temperature: number;
  maxTokens: number;
  n8nUrl?: string;
  openaiEndpoint?: string;
};
