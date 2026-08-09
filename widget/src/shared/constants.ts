/**
 * Shared constants for HomeBot widget
 */

// API Endpoints
export const DEFAULT_N8N_URL = 'http://localhost:5678';
export const HOMEBOT_WEBHOOK_PATH = '/webhook/homebot/chat';
export const HEALTH_PATH = '/healthz';
export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

// User Settings
export const DEFAULT_USER_ID = 'desktop_widget';
// Dark-first: the stylesheet's `:root` block IS the dark palette and light is
// applied as a set of overrides, so defaulting to anything else makes the first
// paint fight the base stylesheet.
export const DEFAULT_THEME: 'light' | 'dark' | 'system' = 'dark';
export const DEFAULT_HOTKEY = 'Ctrl+Shift+Space';
export const DEFAULT_ALWAYS_ON_TOP = true;
export const DEFAULT_CONFIRM_DANGEROUS = true;
export const DEFAULT_SAVE_HISTORY = true;

// Window Configuration
export const WINDOW_WIDTH = 600;
export const WINDOW_HEIGHT = 700;
export const WINDOW_MIN_WIDTH = 400;
export const WINDOW_MIN_HEIGHT = 500;

// IPC Channels
export const IPC_SHOW_WINDOW = 'homebot:show-window';
export const IPC_HIDE_WINDOW = 'homebot:hide-window';
export const IPC_TOGGLE_WINDOW = 'homebot:toggle-window';
export const IPC_SEND_MESSAGE = 'homebot:message';
export const IPC_REPLY = 'homebot:reply';
export const IPC_GET_SETTINGS = 'homebot:get-settings';
export const IPC_SAVE_SETTINGS = 'homebot:save-settings';
export const IPC_HAS_PERMISSION = 'homebot:has-permission';
export const IPC_CHECK_CONNECTION = 'homebot:check-connection';

// UI Configuration
export const MAX_MESSAGE_LENGTH = 5000;
export const MAX_CONVERSATION_HISTORY = 100;
export const MESSAGE_BATCH_SIZE = 20;
export const AUTO_SCROLL_THRESHOLD = 50; // pixels from bottom

// Timeouts & Intervals
export const REQUEST_TIMEOUT = 30000; // 30 seconds
export const CONNECTION_CHECK_INTERVAL = 60000; // 1 minute
export const TYPING_INDICATOR_DELAY = 300; // ms
export const DEBOUNCE_DELAY = 500; // ms

// Status
export const CONNECTION_STATUS = {
  ONLINE: 'online',
  OFFLINE: 'offline',
  CHECKING: 'checking'
} as const;

// Message Roles
export const MESSAGE_ROLES = {
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system'
} as const;

// Input Types
export const INPUT_TYPES = {
  TEXT: 'text',
  VOICE: 'voice',
  VISION: 'vision'
} as const;

// Local Storage Keys
export const STORAGE_KEYS = {
  SETTINGS: 'homebot_settings',
  CONVERSATION: 'homebot_conversation',
  THEME: 'homebot_theme',
  WINDOW_POSITION: 'homebot_window_position'
} as const;

// Error Codes
export const ERROR_CODES = {
  NETWORK_ERROR: 'NETWORK_ERROR',
  CONNECTION_REFUSED: 'CONNECTION_REFUSED',
  TIMEOUT: 'TIMEOUT',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
  IMAGE_LIMIT_EXCEEDED: 'IMAGE_LIMIT_EXCEEDED'
} as const;

// Image attachment limits (defaults used by renderer + main)
export const IMAGE_LIMITS = {
  MAX_IMAGES: 5,
  MAX_PER_IMAGE_BYTES: 5 * 1024 * 1024, // 5 MB
  MAX_TOTAL_BYTES: 10 * 1024 * 1024 // 10 MB
} as const;

// App Metadata
export const APP_NAME = 'HomeBot';
export const APP_VERSION = '1.1.0';
export const APP_DESCRIPTION = 'Desktop AI Assistant';
