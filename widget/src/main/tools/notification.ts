/**
 * HomeBot Notification Tool
 *
 * Shows Windows toast notifications via Electron's Notification API.
 * Falls back to a PowerShell BurntToast / msg.exe call if not available.
 */

import { Notification } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ToolDefinition, ToolHandler, ToolResult } from './types';
import { getSettings } from '../config-manager';

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
    const settings = getSettings();
    if (settings.notificationsEnabled === false) {
      return { success: false, error: 'Notifications are disabled in settings' };
    }

    const title = String(args.title || '').slice(0, 64).trim();
    const body = String(args.body || '').slice(0, 256).trim();

    if (!title) return { success: false, error: 'title is required' };
    if (!body) return { success: false, error: 'body is required' };

    const silent = settings.notificationSound === false || args.urgency !== 'critical';

    // Prefer Electron Notification API (works in main process when app is focused)
    if (Notification.isSupported()) {
      const n = new Notification({ title, body, silent });
      n.show();
      return {
        success: true,
        result: { title, body, method: 'electron' }
      };
    }

    // Fallback: PowerShell msg to current session
    // XML-encode and PS-sanitize to prevent XML injection and command injection
    const xmlEncode = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const psEncode = (s: string) => s.replace(/'/g, '\u2019').replace(/`/g, '').replace(/\$/g, '').replace(/[\x00-\x1F]/g, '');
    const safeTitle = psEncode(xmlEncode(title)).slice(0, 200);
    const safeBody = psEncode(xmlEncode(body)).slice(0, 500);
    await execAsync(
      `powershell -NoProfile -NonInteractive -Command "` +
        `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null; ` +
        `$t = [Windows.UI.Notifications.ToastNotificationManager]; ` +
        `$xml = New-Object Windows.Data.Xml.Dom.XmlDocument; ` +
        `$xml.LoadXml('<toast><visual><binding template=\\"ToastText02\\"><text id=\\"1\\">${safeTitle}</text><text id=\\"2\\">${safeBody}</text></binding></visual></toast>'); ` +
        `$toast = [Windows.UI.Notifications.ToastNotification]::new($xml); ` +
        `$t::CreateToastNotifier('HomeBot').Show($toast)"`
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
