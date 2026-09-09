/** Public connection state: no client credentials, OAuth URLs or tokens. */
export interface YouTubeConnectionStatus {
  configured: boolean;
  signedIn: boolean;
  busy: boolean;
  channels: Array<{ id: string; title: string }>;
  lastChecked?: string;
}

export interface YouTubeConnectionReply {
  ok: boolean;
  status?: YouTubeConnectionStatus;
  cancelled?: boolean;
  error?: string;
}
