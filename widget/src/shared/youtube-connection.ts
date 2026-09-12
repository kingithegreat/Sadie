/** Public connection state: no client credentials, OAuth URLs or tokens. */
export interface YouTubeConnectionStatus {
  configured: boolean;
  signedIn: boolean;
  busy: boolean;
  channels: Array<{ id: string; title: string }>;
  canUpload?: boolean;
  lastChecked?: string;
}

export interface YouTubeConnectionReply {
  ok: boolean;
  status?: YouTubeConnectionStatus;
  cancelled?: boolean;
  error?: string;
}

export type YouTubePrivacyStatus = 'private' | 'unlisted' | 'public';

export interface YouTubeVideoMetadata {
  title: string;
  description?: string;
  tags?: string[];
  categoryId?: string;
  privacyStatus?: YouTubePrivacyStatus;
  publishAt?: string;
  thumbnailPath?: string;
}

export interface YouTubeUploadRequest {
  jobId: string;
  channelId?: string;
  metadata: YouTubeVideoMetadata;
}

export interface YouTubeUploadResult {
  ok: boolean;
  videoId?: string;
  url?: string;
  publishedAt?: string;
  error?: string;
}
