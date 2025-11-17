export interface SadieRequest {
  user_id: string;
  conversation_id: string;
  message: string;
  timestamp?: string;
}

export interface ImageAttachment {
  filename?: string;
  path?: string;
  mimeType?: string;
  size?: number;
  // Payload fields
  data?: string;   // base64 without data URL prefix
  base64?: string; // legacy alias
  dataUrl?: string; // data:<mime>;base64,...
  // Renderer-only preview URL (objectURL or data URL). Main will ignore this field.
  url?: string;
}

/**
 * SadieRequest supports multiple images via `images`.
 * The single `image` field is kept for backward compatibility but is deprecated.
 */
export interface SadieRequestWithImages extends SadieRequest {
  /** @deprecated Prefer `images` for multiple attachments */
  image?: ImageAttachment;
  images?: ImageAttachment[];
}

export interface SadieResponse {
  success: boolean;
  data?: any;
  error?: boolean;
  message?: string;
  details?: string;
  response?: string;
}

export interface Settings {
  alwaysOnTop: boolean;
  n8nUrl: string;
  widgetHotkey: string;
}

export interface ConnectionStatus {
  n8n: 'online' | 'offline' | 'checking';
  ollama: 'online' | 'offline' | 'checking';
  lastChecked?: string;
}

export interface ElectronAPI {
  sendMessage: (request: SadieRequest) => Promise<SadieResponse>;
  getSettings: () => Promise<Settings>;
  saveSettings: (settings: Partial<Settings>) => Promise<Settings>;
  checkConnection: () => Promise<ConnectionStatus>;
  onShowWindow: (callback: () => void) => void;
  onHideWindow: (callback: () => void) => void;
  removeShowWindowListener: () => void;
  removeHideWindowListener: () => void;
  minimizeWindow?: () => void;
  closeWindow?: () => void;
}
