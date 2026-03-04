/**
 * SADIE Notification Tool
 *
 * Shows Windows toast notifications via Electron's Notification API.
 * Falls back to a PowerShell BurntToast / msg.exe call if not available.
 */

import { Notification } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ToolDefinition, ToolHandler, ToolResult } from './types';

const execAsync = promisify(exec);

// ============= TOOL DEFINITIONS =============

export const showNotificationDef: ToolDefinition = {
  name: 'show_notification',
  description:
    'Show a Windows desktop notification (toast) with a title and message. ' +
    'Use to alert the user of completed tasks, reminders, or important information.',
  category: 'system',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'The notification title (max 64 chars)'
      },
      body: {
        type: 'string',
        description: 'The notification body text (max 256 chars)'
      },
      urgency: {
        type: 'string',
        description: 'Urgency level: "normal" (default) or "critical"',
        enum: ['normal', 'critical'],
        default: 'normal'
      }
    },
    required: ['title', 'body']
  }
};

// ============= TOOL HANDLERS =============

export const showNotificationHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const title = String(args.title || '').slice(0, 64).trim();
    const body = String(args.body || '').slice(0, 256).trim();

    if (!title) return { success: false, error: 'title is required' };
    if (!body) return { success: false, error: 'body is required' };

    // Prefer Electron Notification API (works in main process when app is focused)
    if (Notification.isSupported()) {
      const n = new Notification({ title, body, silent: args.urgency !== 'critical' });
      n.show();
      return {
        success: true,
        result: { title, body, method: 'electron' }
      };
    }

    // Fallback: PowerShell msg to current session
    const escapedTitle = title.replace(/"/g, '\\"');
    const escapedBody = body.replace(/"/g, '\\"');
    await execAsync(
      `powershell -NoProfile -NonInteractive -Command "` +
        `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null; ` +
        `$t = [Windows.UI.Notifications.ToastNotificationManager]; ` +
        `$xml = New-Object Windows.Data.Xml.Dom.XmlDocument; ` +
        `$xml.LoadXml('<toast><visual><binding template=\\"ToastText02\\"><text id=\\"1\\">${escapedTitle}</text><text id=\\"2\\">${escapedBody}</text></binding></visual></toast>'); ` +
        `$toast = [Windows.UI.Notifications.ToastNotification]::new($xml); ` +
        `$t::CreateToastNotifier('SADIE').Show($toast)"`
    );

    return {
      success: true,
      result: { title, body, method: 'powershell_toast' }
    };
  } catch (err: any) {
    return { success: false, error: `Notification failed: ${err.message}` };
  }
};

// ============= EXPORTS =============

export const notificationToolDefs: ToolDefinition[] = [showNotificationDef];

export const notificationToolHandlers: Record<string, ToolHandler> = {
  show_notification: showNotificationHandler
};
