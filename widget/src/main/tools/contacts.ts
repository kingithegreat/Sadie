/**
 * HomeBot Contacts Manager Tool
 *
 * Searches for contacts in Microsoft Outlook (via PowerShell COM) and the local
 * Windows address book. Falls back to a simple local JSON contacts store
 * (memory/json-store/contacts.json) if Outlook isn't available.
 */

import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { ToolDefinition, ToolHandler, ToolResult } from './types';

const execAsync = promisify(exec);

const LOCAL_CONTACTS_PATH = path.join(
  process.env.USERPROFILE || process.env.HOME || '',
  'Desktop',
  'homebot',
  'memory',
  'json-store',
  'contacts.json'
);

// ============= TOOL DEFINITIONS =============

export const searchContactsDef: ToolDefinition = {
  name: 'search_contacts',
  description:
    'Search for contacts by name or email. Looks in Microsoft Outlook (if available) ' +
    'and a local contacts store. Returns name, email, phone, and company.',
  category: 'utility',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Name, email address, or company to search for'
      },
      limit: {
        type: 'number',
        description: 'Max results to return (default: 10)',
        default: 10
      }
    },
    required: ['query']
  }
};

export const addContactDef: ToolDefinition = {
  name: 'add_contact',
  description:
    'Add a contact to the local contacts store (contacts.json). ' +
    'Does not modify Outlook directly.',
  category: 'utility',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Full name of the contact'
      },
      email: {
        type: 'string',
        description: 'Email address'
      },
      phone: {
        type: 'string',
        description: 'Phone number (optional)'
      },
      company: {
        type: 'string',
        description: 'Company or organisation (optional)'
      },
      notes: {
        type: 'string',
        description: 'Additional notes (optional)'
      }
    },
    required: ['name']
  }
};

// ============= HELPERS =============

interface Contact {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  notes?: string;
  source: string;
}

async function loadLocalContacts(): Promise<Contact[]> {
  try {
    const raw = await fs.promises.readFile(LOCAL_CONTACTS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveLocalContacts(contacts: Contact[]): Promise<void> {
  await fs.promises.mkdir(path.dirname(LOCAL_CONTACTS_PATH), { recursive: true });
  await fs.promises.writeFile(LOCAL_CONTACTS_PATH, JSON.stringify(contacts, null, 2), 'utf8');
}

async function searchOutlook(query: string, limit: number): Promise<Contact[]> {
  const safe = query.replace(/['"]/g, '').slice(0, 128);
  const cmd =
    `powershell -NoProfile -NonInteractive -Command "` +
    `try { ` +
    `$ol = New-Object -ComObject Outlook.Application; ` +
    `$ns = $ol.GetNamespace('MAPI'); ` +
    `$contacts = $ns.GetDefaultFolder(10).Items; ` +
    `$results = @(); ` +
    `foreach ($c in $contacts) { ` +
    `  if ($c.FullName -like '*${safe}*' -or $c.Email1Address -like '*${safe}*' -or $c.CompanyName -like '*${safe}*') { ` +
    `    $results += @{ name=$c.FullName; email=$c.Email1Address; phone=$c.BusinessTelephoneNumber; company=$c.CompanyName }; ` +
    `    if ($results.Count -ge ${limit}) { break } ` +
    `  } ` +
    `} ` +
    `$results | ConvertTo-Json -Depth 3 -Compress ` +
    `} catch { '[]' }"`;

  try {
    const { stdout } = await execAsync(cmd, { timeout: 10000, windowsHide: true });
    let raw: any = JSON.parse(stdout.trim() || '[]');
    if (!Array.isArray(raw)) raw = raw ? [raw] : [];
    return raw.map((c: any) => ({ ...c, source: 'outlook' }));
  } catch {
    return [];
  }
}

// ============= TOOL HANDLERS =============

export const searchContactsHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const query = String(args.query || '').trim().toLowerCase();
    if (!query) return { success: false, error: 'query is required' };

    const limit = Math.min(Math.max(1, Number(args.limit) || 10), 50);

    // Try Outlook first
    const outlookResults = await searchOutlook(query, limit);

    // Also search local store
    const local = await loadLocalContacts();
    const localResults = local
      .filter(
        (c) =>
          c.name?.toLowerCase().includes(query) ||
          c.email?.toLowerCase().includes(query) ||
          c.company?.toLowerCase().includes(query)
      )
      .slice(0, limit)
      .map((c) => ({ ...c, source: c.source || 'local' }));

    // Merge, deduplicate by email
    const seen = new Set<string>();
    const combined: Contact[] = [];
    for (const c of [...outlookResults, ...localResults]) {
      const key = c.email?.toLowerCase() || c.name?.toLowerCase() || Math.random().toString();
      if (!seen.has(key)) {
        seen.add(key);
        combined.push(c);
      }
    }

    return {
      success: true,
      result: { count: combined.length, contacts: combined.slice(0, limit) }
    };
  } catch (err: any) {
    return { success: false, error: `search_contacts failed: ${err.message}` };
  }
};

export const addContactHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const name = String(args.name || '').trim();
    if (!name) return { success: false, error: 'name is required' };

    const contact: Contact = {
      name,
      email: args.email ? String(args.email).trim() : undefined,
      phone: args.phone ? String(args.phone).trim() : undefined,
      company: args.company ? String(args.company).trim() : undefined,
      notes: args.notes ? String(args.notes).trim() : undefined,
      source: 'local'
    };

    const existing = await loadLocalContacts();
    existing.push(contact);
    await saveLocalContacts(existing);

    return { success: true, result: { added: contact } };
  } catch (err: any) {
    return { success: false, error: `add_contact failed: ${err.message}` };
  }
};

// ============= EXPORTS =============

export const contactsToolDefs: ToolDefinition[] = [searchContactsDef, addContactDef];

export const contactsToolHandlers: Record<string, ToolHandler> = {
  search_contacts: searchContactsHandler,
  add_contact: addContactHandler
};
