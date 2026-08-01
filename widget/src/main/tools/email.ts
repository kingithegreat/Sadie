/**
 * HomeBot Email Tools
 *
 * Send, draft, and list emails via Microsoft Outlook COM automation.
 * Falls back to a local draft store (memory/json-store/email-drafts.json)
 * when Outlook is unavailable.
 *
 * Tools:
 *   email_send   — compose and send an email (ALWAYS requires confirmation)
 *   email_draft  — save a draft in Outlook or the local store (requires confirmation)
 *   email_list   — list recent inbox items
 */

import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { ToolDefinition, ToolHandler, ToolResult } from './types';
import { getCrmStore } from './crm';

const execAsync = promisify(exec);

// ----- Local draft fallback -----

const LOCAL_DRAFTS_PATH = path.join(
  process.env.USERPROFILE || process.env.HOME || '',
  'Desktop', 'homebot', 'memory', 'json-store', 'email-drafts.json'
);

interface EmailDraft {
  id: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  createdAt: string;
  sent?: boolean;
}

function loadDrafts(): EmailDraft[] {
  try {
    if (fs.existsSync(LOCAL_DRAFTS_PATH)) {
      return JSON.parse(fs.readFileSync(LOCAL_DRAFTS_PATH, 'utf-8')) as EmailDraft[];
    }
  } catch { /* ignore */ }
  return [];
}

function saveDrafts(drafts: EmailDraft[]): void {
  try {
    fs.mkdirSync(path.dirname(LOCAL_DRAFTS_PATH), { recursive: true });
    fs.writeFileSync(LOCAL_DRAFTS_PATH, JSON.stringify(drafts, null, 2), 'utf-8');
  } catch (e) {
    console.error('[Email] Failed to save drafts:', e);
  }
}

function makeDraftId(): string {
  return `em_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ----- Input validation -----

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseRecipients(raw: string | string[]): string[] {
  const arr = Array.isArray(raw)
    ? raw
    : String(raw)
        .split(/[,;]+/)
        .map(s => s.trim())
        .filter(Boolean);
  const valid = arr.filter(e => EMAIL_RE.test(e));
  return valid;
}

/** Sanitize string for PowerShell single-quoted context */
function sanitizePS(value: string): string {
  return String(value)
    .replace(/'/g, '\u2019')
    .replace(/`/g, '')
    .replace(/\$/g, '')
    .replace(/[\x00-\x1F]/g, '');
}

// ----- Outlook COM helpers -----

async function outlookSend(
  to: string[],
  cc: string[],
  subject: string,
  body: string
): Promise<void> {
  const toStr  = sanitizePS(to.join('; '));
  const ccStr  = sanitizePS(cc.join('; '));
  const subStr = sanitizePS(subject);
  const bdStr  = sanitizePS(body);

  const script = `
$ol   = New-Object -ComObject Outlook.Application -ErrorAction Stop
$mail = $ol.CreateItem(0)
$mail.To      = '${toStr}'
$mail.CC      = '${ccStr}'
$mail.Subject = '${subStr}'
$mail.Body    = '${bdStr}'
$mail.Send()
Write-Output 'sent'
`.trim();

  const { stdout } = await execAsync(
    `powershell -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`,
    { timeout: 20000 }
  );
  if (!stdout.includes('sent')) throw new Error('Send did not confirm');
}

async function outlookDraft(
  to: string[],
  cc: string[],
  subject: string,
  body: string
): Promise<void> {
  const toStr  = sanitizePS(to.join('; '));
  const ccStr  = sanitizePS(cc.join('; '));
  const subStr = sanitizePS(subject);
  const bdStr  = sanitizePS(body);

  const script = `
$ol   = New-Object -ComObject Outlook.Application -ErrorAction Stop
$mail = $ol.CreateItem(0)
$mail.To      = '${toStr}'
$mail.CC      = '${ccStr}'
$mail.Subject = '${subStr}'
$mail.Body    = '${bdStr}'
$mail.Save()
Write-Output 'saved'
`.trim();

  const { stdout } = await execAsync(
    `powershell -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`,
    { timeout: 20000 }
  );
  if (!stdout.includes('saved')) throw new Error('Save did not confirm');
}

async function outlookListInbox(limit: number): Promise<any[]> {
  const script = `
$ol    = New-Object -ComObject Outlook.Application -ErrorAction Stop
$inbox = $ol.GetNamespace('MAPI').GetDefaultFolder(6)
$items = $inbox.Items
$items.Sort('[ReceivedTime]', $true)
$results = @()
$count = 0
foreach ($item in $items) {
  if ($count -ge ${limit}) { break }
  $results += @{
    subject  = $item.Subject
    from     = $item.SenderEmailAddress
    received = $item.ReceivedTime.ToString('o')
    unread   = -not $item.UnRead -eq $false
    preview  = ($item.Body -replace "[\\r\\n]+"," ").Substring(0, [Math]::Min(($item.Body -replace "[\\r\\n]+"," ").Length, 200))
  }
  $count++
}
$results | ConvertTo-Json -Depth 3 -Compress
`.trim();

  const { stdout } = await execAsync(
    `powershell -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`,
    { timeout: 15000 }
  );
  const raw = stdout.trim();
  if (!raw || raw === 'null') return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [parsed];
}

// ----- CRM wiring (Phase 1: inbound email → the built-in CRM) -----
//
// email_list is the only place inbound mail enters SADIE, so this is where the
// CRM email-sync hook (CrmStore.matchInboundEmail) is wired in:
//   • Annotation (always, read-only): each listed email whose sender is a
//     known CRM contact gets a `crm` field. Listing never writes.
//   • Capture (opt-in via captureToCrm): unique human senders are run through
//     find-or-create + an inbound-email activity — one match per sender per
//     call, automated senders skipped.
// CRM failures must never break email listing; every entry point is guarded.

/** Local-parts that indicate automated mail — never auto-created as contacts. */
const NON_HUMAN_LOCAL_RE =
  /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?|notifications?|newsletters?|marketing|alerts?)([+._-]|$)/i;

/** True if this sender address is a plausible human worth capturing to the CRM. */
export function isCapturableSender(email: string): boolean {
  if (!EMAIL_RE.test(email)) return false;
  return !NON_HUMAN_LOCAL_RE.test(email.split('@')[0]);
}

export interface EmailCrmAnnotation {
  contactId: number;
  contactName: string;
  companyId: number | null;
  companyName: string | null;
}

export interface EmailCaptureSummary {
  email: string;
  contactId: number;
  created: boolean;
  activityId: number;
}

/**
 * Read-only pass: attach `crm: EmailCrmAnnotation | null` to each listed
 * email whose sender is already a CRM contact. Never throws.
 */
export function annotateEmailsWithCrm(emails: any[]): void {
  let store: ReturnType<typeof getCrmStore>;
  try {
    store = getCrmStore();
  } catch {
    return; // CRM unavailable — listing proceeds unannotated
  }
  for (const em of emails) {
    const from = String(em?.from ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(from)) {
      em.crm = null;
      continue;
    }
    try {
      const contact = store.findContactByEmail(from);
      if (!contact) {
        em.crm = null;
        continue;
      }
      const company = contact.companyId != null ? store.getCompany(contact.companyId) : null;
      const annotation: EmailCrmAnnotation = {
        contactId: contact.id,
        contactName: [contact.firstName, contact.lastName].filter(Boolean).join(' '),
        companyId: company?.id ?? null,
        companyName: company?.name ?? null,
      };
      em.crm = annotation;
    } catch {
      em.crm = null;
    }
  }
}

/**
 * Opt-in pass: run each unique human sender through
 * CrmStore.matchInboundEmail (find-or-create contact + company from domain,
 * log an inbound email activity). One match per unique sender per call so a
 * busy thread doesn't spam the activity log. Never throws.
 */
export function captureEmailsToCrm(emails: any[]): {
  captured: EmailCaptureSummary[];
  skipped: number;
} {
  const captured: EmailCaptureSummary[] = [];
  let skipped = 0;
  let store: ReturnType<typeof getCrmStore>;
  try {
    store = getCrmStore();
  } catch {
    return { captured, skipped: emails.length };
  }
  const seen = new Set<string>();
  for (const em of emails) {
    const from = String(em?.from ?? '').trim().toLowerCase();
    if (!isCapturableSender(from) || seen.has(from)) {
      skipped++;
      continue;
    }
    seen.add(from);
    try {
      const res = store.matchInboundEmail(from, {
        subject: String(em?.subject ?? '').trim() || undefined,
        body: typeof em?.preview === 'string' && em.preview ? em.preview : undefined,
      });
      captured.push({
        email: from,
        contactId: res.contact.id,
        created: res.created,
        activityId: res.activityId,
      });
    } catch {
      skipped++;
    }
  }
  return { captured, skipped };
}

// ----- Tool definitions -----

export const emailSendDef: ToolDefinition = {
  name: 'email_send',
  description:
    'Compose and send an email via Microsoft Outlook. ' +
    'Always requires user confirmation before sending. ' +
    'to must contain at least one valid email address.',
  category: 'communication',
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        description: 'Recipient email address(es), comma-separated',
      },
      subject: {
        type: 'string',
        description: 'Email subject line',
      },
      body: {
        type: 'string',
        description: 'Email body text',
      },
      cc: {
        type: 'string',
        description: 'CC recipients, comma-separated (optional)',
        default: '',
      },
    },
    required: ['to', 'subject', 'body'],
  },
};

export const emailDraftDef: ToolDefinition = {
  name: 'email_draft',
  description:
    'Save an email as a draft in Outlook (or the local draft store if Outlook is unavailable). ' +
    'Requires user confirmation.',
  category: 'communication',
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        description: 'Recipient email address(es), comma-separated',
      },
      subject: {
        type: 'string',
        description: 'Email subject line',
      },
      body: {
        type: 'string',
        description: 'Email body text',
      },
      cc: {
        type: 'string',
        description: 'CC recipients, comma-separated (optional)',
        default: '',
      },
    },
    required: ['to', 'subject', 'body'],
  },
};

export const emailListDef: ToolDefinition = {
  name: 'email_list',
  description:
    'List the most recent emails in the Outlook inbox. Senders already in the CRM are ' +
    'annotated with their contact and company (read-only). Set captureToCrm=true to also ' +
    'sync the inbox into the CRM: each unique human sender is matched or created as a ' +
    'contact (company inferred from the email domain) and logged as an inbound email ' +
    'activity. Automated senders (no-reply, notifications, newsletters…) are never captured.',
  category: 'communication',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of emails to return (default: 10, max: 50)',
        default: 10,
      },
      captureToCrm: {
        type: 'boolean',
        description:
          'Sync listed senders into the CRM (find-or-create contact + company, log inbound ' +
          'email activity). One capture per unique sender per call. Default: false.',
        default: false,
      },
    },
    required: [],
  },
};

// ----- Tool handlers -----

export const emailSendHandler: ToolHandler = async (args): Promise<ToolResult> => {
  const toList  = parseRecipients((args.to as any) ?? '');
  const ccList  = parseRecipients((args.cc as any) ?? '');
  const subject = String(args.subject ?? '').trim();
  const body    = String(args.body    ?? '').trim();

  if (toList.length === 0) return { success: false, error: 'At least one valid recipient email is required in "to".' };
  if (!subject)            return { success: false, error: 'subject is required.' };
  if (!body)               return { success: false, error: 'body is required.' };

  let viaOutlook = false;
  try {
    await outlookSend(toList, ccList, subject, body);
    viaOutlook = true;
  } catch (err) {
    // Outlook unavailable — save as local draft
    console.log('[Email] Outlook send failed, saving as local draft:', (err as any)?.message?.slice(0, 80));
    const draft: EmailDraft = {
      id: makeDraftId(),
      to: toList,
      ...(ccList.length ? { cc: ccList } : {}),
      subject,
      body,
      createdAt: new Date().toISOString(),
      sent: false,
    };
    const drafts = loadDrafts();
    drafts.push(draft);
    saveDrafts(drafts);
    return {
      success: true,
      result: {
        sent: false,
        draftSaved: true,
        draftId: draft.id,
        to: toList,
        subject,
        note: 'Outlook is not available. The email has been saved as a local draft.',
      },
    };
  }

  // Mark in local drafts as sent
  const drafts = loadDrafts();
  const draftEntry: EmailDraft = {
    id: makeDraftId(),
    to: toList,
    ...(ccList.length ? { cc: ccList } : {}),
    subject,
    body,
    createdAt: new Date().toISOString(),
    sent: true,
  };
  drafts.push(draftEntry);
  saveDrafts(drafts);

  return {
    success: true,
    result: {
      sent: viaOutlook,
      to: toList,
      ...(ccList.length ? { cc: ccList } : {}),
      subject,
    },
  };
};

export const emailDraftHandler: ToolHandler = async (args): Promise<ToolResult> => {
  const toList  = parseRecipients((args.to as any) ?? '');
  const ccList  = parseRecipients((args.cc as any) ?? '');
  const subject = String(args.subject ?? '').trim();
  const body    = String(args.body    ?? '').trim();

  if (toList.length === 0) return { success: false, error: 'At least one valid recipient email is required in "to".' };
  if (!subject)            return { success: false, error: 'subject is required.' };
  if (!body)               return { success: false, error: 'body is required.' };

  let savedToOutlook = false;
  try {
    await outlookDraft(toList, ccList, subject, body);
    savedToOutlook = true;
  } catch (err) {
    console.log('[Email] Outlook draft failed, using local store:', (err as any)?.message?.slice(0, 80));
  }

  const draft: EmailDraft = {
    id: makeDraftId(),
    to: toList,
    ...(ccList.length ? { cc: ccList } : {}),
    subject,
    body,
    createdAt: new Date().toISOString(),
    sent: false,
  };
  const drafts = loadDrafts();
  drafts.push(draft);
  saveDrafts(drafts);

  return {
    success: true,
    result: {
      drafted: true,
      draftId: draft.id,
      to: toList,
      subject,
      savedToOutlook,
    },
  };
};

export const emailListHandler: ToolHandler = async (args): Promise<ToolResult> => {
  const limit = Math.max(1, Math.min(Number(args.limit) || 10, 50));

  let emails: any[] = [];
  let source = 'local';

  try {
    emails = await outlookListInbox(limit);
    if (emails.length > 0) source = 'outlook';
  } catch (err) {
    console.log('[Email] Outlook list failed:', (err as any)?.message?.slice(0, 80));
  }

  // Fallback to local drafts if Outlook unavailable
  if (emails.length === 0) {
    const drafts = loadDrafts().filter(d => !d.sent);
    emails = drafts.slice(-limit).map(d => ({
      subject:  d.subject,
      from:     `(to: ${d.to.join(', ')})`,
      received: d.createdAt,
      preview:  d.body.slice(0, 200),
      isDraft:  true,
    }));
  }

  // CRM wiring: opt-in capture of live inbox senders, then read-only
  // annotation for everyone. Guarded — CRM problems never break listing.
  const wantCapture = args.captureToCrm === true || args.captureToCrm === 'true';
  let crmCaptured: EmailCaptureSummary[] | undefined;
  let crmNote: string | undefined;
  try {
    if (wantCapture && source === 'outlook') {
      crmCaptured = captureEmailsToCrm(emails).captured;
    } else if (wantCapture) {
      crmNote = 'captureToCrm skipped: no live Outlook inbox (local drafts are not inbound email).';
    }
    annotateEmailsWithCrm(emails);
  } catch (err) {
    crmNote = `CRM annotation unavailable: ${(err as any)?.message?.slice(0, 120) || 'unknown error'}`;
  }

  return {
    success: true,
    result: {
      emails,
      count: emails.length,
      source,
      ...(crmCaptured !== undefined ? { crmCaptured } : {}),
      ...(crmNote ? { crmNote } : {}),
    },
  };
};

// ----- Exports -----

export const emailToolDefs: ToolDefinition[] = [
  emailSendDef,
  emailDraftDef,
  emailListDef,
];

export const emailToolHandlers: Record<string, ToolHandler> = {
  email_send:  emailSendHandler,
  email_draft: emailDraftHandler,
  email_list:  emailListHandler,
};
