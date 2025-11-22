import axios from 'axios';
import { Settings } from '../../shared/types';

interface SadieRequest {
  user_id: string;
  message: string;
  conversation_id: string;
}

interface SadieResponse {
  error?: boolean;
  message: string;
  details?: string;
  [key: string]: any;
}

/**
 * Send a message to the SADIE orchestrator via n8n webhook
 * 
 * @param message - The user's message to send
 * @param conversationId - The conversation ID for message threading
 * @returns The response from the SADIE orchestrator
 * 
 * Note: This function is provided for potential future direct calls.
 * In the current IPC architecture, the main process handles all n8n communication.
 */
export async function sendToSadie(
  message: string,
  conversationId: string
): Promise<SadieResponse> {
  try {
    // Load settings from the preload API
    const settings: Settings = await window.electron.getSettings?.();

    // Construct the webhook URL
    const webhookUrl = `${settings.n8nUrl}/webhook/sadie/chat`;

    // Prepare the request body
    const requestBody: SadieRequest = {
      user_id: 'desktop-user',
      message,
      conversation_id: conversationId,
    };

    // Send POST request to n8n orchestrator
    const response = await axios.post<SadieResponse>(webhookUrl, requestBody, {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000, // 30 second timeout
    });

    return response.data;
  } catch (err: any) {
    // Handle request failures
    return {
      error: true,
      message: 'Could not reach SADIE orchestrator.',
      details: err.message || 'Unknown error occurred',
    };
  }
}
