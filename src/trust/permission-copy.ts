/**
 * Trust layer (Phase 2) — permission copy.
 *
 * Plain-English labels and one-line explanations for every permission the
 * PermissionModal can ask about, so the person deciding sees "Write files —
 * create or overwrite a file on your computer" instead of the raw tool slug
 * ("write_file"). Closes the copy half of the issue #6 "permission modal
 * copy/accessibility pass".
 *
 * Pure and dependency-free on purpose: lives in root src so the required CI
 * gate (tsc + jest) protects it, same placement as the CRM core, the
 * supervisor, and the batch/activity summarizers. The renderer only maps
 * over these functions.
 *
 * Drift guard: a widget-side test asserts every key in the config-manager
 * permission defaults resolves here without falling back to the generic
 * prettifier, so a new tool permission cannot ship without human copy
 * (or an MCP-style name the heuristic already explains).
 */

export interface PermissionCopy {
  /** Short human verb phrase, e.g. "Write files". */
  label: string;
  /** One plain sentence describing exactly what is being granted. */
  detail: string;
}

export type PermissionCopySource = 'known' | 'mcp' | 'fallback';

export interface DescribedPermission extends PermissionCopy {
  /** The raw permission name this copy describes. */
  name: string;
  /** Where the copy came from — 'fallback' means nobody wrote copy for it. */
  source: PermissionCopySource;
}

/** Explicit copy for every native tool permission in the config-manager
 *  defaults. Grouped and ordered to mirror DEFAULT_SETTINGS.permissions. */
export const KNOWN_PERMISSION_COPY: Record<string, PermissionCopy> = {
  // File system — read-only
  read_file: { label: 'Read files', detail: 'Open and read a file on your computer.' },
  list_directory: { label: 'List folders', detail: 'See which files are inside a folder.' },
  create_directory: { label: 'Create folders', detail: 'Make a new folder on your computer.' },
  get_file_info: { label: 'Check file details', detail: "Look up a file's size, dates, and type." },
  copy_file: { label: 'Copy files', detail: 'Copy a file to another location on your computer.' },
  search_files: { label: 'Search your files', detail: 'Search your folders for files matching a pattern.' },
  find_files: { label: 'Find files', detail: 'Search your folders for files by name.' },
  parse_document_from_path: { label: 'Read documents', detail: 'Open a document file (PDF, Word, etc.) and read its contents.' },
  // File system — writes
  write_file: { label: 'Write files', detail: 'Create a new file or overwrite an existing one on your computer.' },
  edit_file: { label: 'Edit files', detail: 'Change the contents of an existing file on your computer.' },
  delete_file: { label: 'Delete files', detail: 'Permanently remove a file from your computer.' },
  move_file: { label: 'Move or rename files', detail: 'Move a file to a new location or give it a new name.' },
  create_docx: { label: 'Create Word documents', detail: 'Write a new Word (.docx) document to your computer.' },
  create_spreadsheet: { label: 'Create spreadsheets', detail: 'Write a new spreadsheet file to your computer.' },
  create_pdf: { label: 'Create PDFs', detail: 'Write a new PDF file to your computer.' },
  // System — read-only
  get_system_info: { label: 'Check system info', detail: 'Read basic information about this computer (OS, memory, CPU).' },
  get_current_time: { label: 'Check the time', detail: 'Read the current date and time.' },
  calculate: { label: 'Do calculations', detail: 'Evaluate a math expression. Nothing leaves your computer.' },
  open_url: { label: 'Open links', detail: 'Open a web address in your default browser.' },
  open_in_browser: { label: 'Open pages in your browser', detail: 'Open a page in your default browser.' },
  browser_search: { label: 'Search in your browser', detail: 'Open a web search in your default browser.' },
  show_notification: { label: 'Show notifications', detail: 'Show a desktop notification on this computer.' },
  // System — sensitive
  launch_app: { label: 'Launch applications', detail: 'Start another program installed on your computer.' },
  screenshot: { label: 'Take screenshots', detail: 'Capture an image of what is currently on your screen.' },
  // Network / info — read-only
  web_search: { label: 'Search the web', detail: 'Send a search query to the internet and read the results.' },
  fetch_url: { label: 'Fetch web pages', detail: 'Download the contents of a web address.' },
  fetch_page_content: { label: 'Read web pages', detail: 'Download and read the text of a web page.' },
  nba_query: { label: 'Look up NBA data', detail: 'Fetch basketball scores and stats from the internet.' },
  get_news: { label: 'Fetch news', detail: 'Download headlines from your news feeds.' },
  list_news_feeds: { label: 'List news feeds', detail: 'See which news feeds are configured.' },
  get_weather: { label: 'Check the weather', detail: 'Fetch the weather forecast from the internet.' },
  image_generate: { label: 'Generate images', detail: 'Create an image with the configured image model.' },
  // Documents — read-only
  parse_document: { label: 'Parse documents', detail: 'Read the contents of a document you provide.' },
  get_document_content: { label: 'Read stored documents', detail: 'Read the text of a document already loaded into HomeBot.' },
  list_documents: { label: 'List stored documents', detail: 'See which documents are loaded into HomeBot.' },
  search_document: { label: 'Search stored documents', detail: 'Search inside documents already loaded into HomeBot.' },
  // Vision
  vision_describe: { label: 'Describe images', detail: 'Look at an image and describe what is in it.' },
  vision_query: { label: 'Answer questions about images', detail: 'Look at an image and answer a question about it.' },
  // Voice
  speak: { label: 'Speak out loud', detail: 'Read text aloud through your speakers.' },
  stop_speaking: { label: 'Stop speaking', detail: 'Stop any speech currently playing.' },
  get_voices: { label: 'List voices', detail: 'See which text-to-speech voices are available.' },
  // Memory
  remember: { label: 'Save memories', detail: 'Save a note to HomeBot’s long-term memory on this computer.' },
  recall: { label: 'Recall memories', detail: 'Read notes from HomeBot’s long-term memory.' },
  list_memories: { label: 'List memories', detail: 'See everything saved in HomeBot’s long-term memory.' },
  forget: { label: 'Delete memories', detail: 'Permanently delete saved memories.' },
  save_conversation: { label: 'Save conversations', detail: 'Save this conversation to your computer.' },
  get_conversation_history: { label: 'Read conversation history', detail: 'Read previous conversations saved on this computer.' },
  clear_conversation_history: { label: 'Clear conversation history', detail: 'Permanently delete saved conversations.' },
  // RAG
  rag_query: { label: 'Search your knowledge base', detail: 'Search the documents you have indexed for answers.' },
  rag_list: { label: 'List indexed documents', detail: 'See which documents are in your knowledge base.' },
  rag_index: { label: 'Index documents', detail: 'Add documents to your searchable knowledge base.' },
  rag_clear: { label: 'Clear the knowledge base', detail: 'Permanently delete the indexed knowledge base.' },
  // Diff — pure computation
  diff_text: { label: 'Compare text', detail: 'Compare two pieces of text. Nothing leaves your computer.' },
  diff_files: { label: 'Compare files', detail: 'Read two files and show the differences between them.' },
  // Automations
  create_automation: { label: 'Create automations', detail: 'Save a new automation that can run on a schedule.' },
  list_automations: { label: 'List automations', detail: 'See which automations are set up.' },
  run_automation: { label: 'Run automations', detail: 'Run one of your saved automations now.' },
  update_automation: { label: 'Edit automations', detail: 'Change one of your saved automations.' },
  delete_automation: { label: 'Delete automations', detail: 'Permanently remove a saved automation.' },
  // Reminders & calendar
  list_reminders: { label: 'List reminders', detail: 'See your scheduled reminders.' },
  set_reminder: { label: 'Set reminders', detail: 'Schedule a reminder that will notify you later.' },
  cancel_reminder: { label: 'Cancel reminders', detail: 'Remove a scheduled reminder.' },
  list_calendar_events: { label: 'Read your calendar', detail: 'See events on your local calendar.' },
  add_calendar_event: { label: 'Add calendar events', detail: 'Create a new event on your local calendar.' },
  delete_calendar_event: { label: 'Delete calendar events', detail: 'Remove an event from your local calendar.' },
  // Clipboard
  clipboard_read: { label: 'Read the clipboard', detail: 'Read whatever is currently copied to your clipboard.' },
  clipboard_write: { label: 'Write to the clipboard', detail: 'Replace the contents of your clipboard.' },
  get_clipboard: { label: 'Check the clipboard', detail: 'Read whatever is currently copied to your clipboard.' },
  set_clipboard: { label: 'Set the clipboard', detail: 'Replace the contents of your clipboard.' },
  // Planning & contacts
  plan_task: { label: 'Plan tasks', detail: 'Break a request into a step-by-step plan.' },
  get_plans: { label: 'Read plans', detail: 'See previously created task plans.' },
  search_contacts: { label: 'Search contacts', detail: 'Search the contacts saved in HomeBot.' },
  add_contact: { label: 'Add contacts', detail: 'Save a new contact in HomeBot.' },
  // Git — read-only ops safe
  git_status: { label: 'Check git status', detail: 'Read the state of a git repository on your computer.' },
  git_log: { label: 'Read git history', detail: 'Read the commit history of a git repository.' },
  git_diff: { label: 'Read git changes', detail: 'Read uncommitted changes in a git repository.' },
  git_branches: { label: 'List git branches', detail: 'See the branches of a git repository.' },
  git_commit: { label: 'Make git commits', detail: 'Create a commit in a git repository on your computer.' },
  // Media Studio — the video pipeline. Wording is about what happens to the
  // video, not the pipeline stage, because that is what the decision is about.
  read_browser_page: { label: 'Read the open page', detail: 'Read the text of the page in the browser panel.' },
  list_browser_targets: { label: 'See what is on the page', detail: 'List the links, buttons and fields visible in the browser panel.' },
  click_browser_target: { label: 'Click in the browser', detail: 'Click a link or button in the browser panel, using your logged-in sessions.' },
  type_in_browser: { label: 'Type in the browser', detail: 'Type text into a field on the page in the browser panel.' },
  navigate_browser: { label: 'Open a web page', detail: 'Open a web address in the browser panel.' },
  media_setup_research: { label: 'Set up video research', detail: 'Add a workflow to your n8n so video scripts are written from real fetched sources.' },
  media_narrate: { label: 'Record narration', detail: 'Turn a video script into an audio file using the built-in voice. Nothing is uploaded.' },
  media_narrate_clip: { label: 'Narrate one of your videos', detail: 'Watch a video clip already on this machine, write a commentary for it and save a narrated copy beside it. The clip is analysed with your Google AI Studio key; nothing else is uploaded.' },
  media_write_script: { label: 'Write a video script', detail: 'Research a video and write its narration using your configured model.' },
  media_render: { label: 'Render a video', detail: 'Combine the narration, captions and a background into a video file on your machine. Nothing is uploaded.' },
  media_delete_job: { label: 'Delete a video and its files', detail: 'Permanently removes a Media Studio job and everything it produced — narration, captions, images and the rendered video. Cannot be undone.' },
  media_create_job: { label: 'Start a video', detail: 'Add a new video to the Media Studio. Nothing is published.' },
  media_list_jobs: { label: 'List your videos', detail: 'See videos in progress and the stage each has reached.' },
  media_advance_job: { label: 'Move a video along', detail: 'Move a video to its next stage. Cannot approve or publish it.' },
  media_approve_job: { label: 'Approve a video', detail: 'Approve a finished video so it can be scheduled and published.' },
  media_reject_job: { label: 'Reject a video', detail: 'Reject a video, or send it back for another revision.' },
  media_list_music: { label: 'List music', detail: 'See the music available for video narration soundtracks.' },
  // Skills
  use_skill: { label: 'Load a skill', detail: 'Load a saved step-by-step recipe into the conversation. It only returns instructions.' },
  list_skills: { label: 'List skills', detail: 'See which skill recipes are installed.' },
  // Vision — read-only
  look_at_browser: { label: 'Read the open page', detail: 'Look at the page currently open in the browser panel and answer questions about it.' },
  // Navigation — moves the user to another panel
  navigate_to_mode: { label: 'Take you to another mode', detail: 'Open a HomeBot panel (Media Studio, Automations, and so on) for you. Nothing is read or changed on disk.' },
  // CRM — reads
  crm_search_companies: { label: 'Search CRM companies', detail: 'Look up companies in the business CRM.' },
  crm_search_contacts: { label: 'Search CRM contacts', detail: 'Look up people in the business CRM.' },
  crm_search_deals: { label: 'Search deals', detail: 'Look up deals in the sales pipeline.' },
  crm_find_stale_deals: { label: 'Find quiet deals', detail: 'List open deals with no recent activity.' },
  crm_daily_brief: { label: 'Summarise the CRM', detail: 'Summarise stale deals, tasks and pipeline totals.' },
  crm_get_stages: { label: 'List pipeline stages', detail: 'Show the stages a deal moves through.' },
  crm_audit_log: { label: 'Read CRM history', detail: 'Read the record of every change made in the CRM.' },
  // CRM — writes (each also shows its own confirmation in chat)
  crm_create_company: { label: 'Create a CRM company', detail: 'Add a new company to the business CRM.' },
  crm_update_company: { label: 'Update a CRM company', detail: 'Change fields on an existing company record.' },
  crm_create_contact: { label: 'Create a CRM contact', detail: 'Add a new person to the business CRM.' },
  crm_update_contact: { label: 'Update a CRM contact', detail: 'Change fields on an existing contact record.' },
  crm_create_deal: { label: 'Create a deal', detail: 'Add a new deal/opportunity to the pipeline.' },
  crm_update_deal: { label: 'Update a deal', detail: 'Change fields on an existing deal.' },
  crm_advance_deal: { label: 'Move a deal along', detail: 'Move a deal to its next pipeline stage.' },
  crm_log_activity: { label: 'Log a touchpoint', detail: 'Record an email, call or meeting against a CRM record.' },
  crm_add_note: { label: 'Add a CRM note', detail: 'Attach a note to a contact, company or deal.' },
  crm_create_task: { label: 'Create a CRM task', detail: 'Add a follow-up task to the CRM.' },
  crm_complete_task: { label: 'Complete a CRM task', detail: 'Mark a CRM task as done.' },
  crm_rename_stage: { label: 'Rename a pipeline stage', detail: 'Change the display name of a pipeline stage.' },
  crm_match_email: { label: 'Match an email to the CRM', detail: 'Link an email sender to CRM records, creating them if needed.' },
  crm_export: { label: 'Export the CRM', detail: 'Write every CRM table to files on disk.' },
  // Processes
  list_processes: { label: 'List running programs', detail: 'See which programs are running on this computer.' },
  get_process_info: { label: 'Check a running program', detail: 'Read details about a running program.' },
  kill_process: { label: 'Stop running programs', detail: 'Force-quit a program running on this computer.' },
  // Code execution
  run_code: { label: 'Run code', detail: 'Execute code on this computer. Only allow this if you trust the request.' },
  // Terminal
  run_terminal_command: { label: 'Run terminal commands', detail: 'Run a command in the terminal. Each command still shows its own confirmation.' },
  get_terminal_history: { label: 'Read terminal history', detail: 'Read the commands previously run through HomeBot.' },
  // Codebase — read-only
  grep_code: { label: 'Search code', detail: 'Search source code files on your computer for matching text.' },
  project_tree: { label: 'Map a project', detail: 'List the folder structure of a code project.' },
  analyze_file: { label: 'Analyze code files', detail: 'Read and analyze a source code file.' },
  // Email
  email_send: { label: 'Send email', detail: 'Send an email from your connected email account.' },
  email_draft: { label: 'Draft email', detail: 'Create a draft in your connected email account. Nothing is sent.' },
  email_list: { label: 'Read your inbox', detail: 'Read message summaries from your connected email account.' },
  // API
  api_request: { label: 'Call web APIs', detail: 'Send a network request to an internet service and read the response.' },
};

/** "file_write" → "File write"; "get_video_info" → "Get video info". */
export function prettifyPermissionName(name: string): string {
  const words = name.replace(/[_-]+/g, ' ').trim();
  if (!words) return name;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const MCP_NAME = /^mcp_([a-z0-9]+)_(.+)$/i;

/** Plain-English copy for a permission name, with graceful degradation:
 *  known registry → MCP-tool heuristic → prettified slug. Never throws. */
export function describePermission(name: string): DescribedPermission {
  const known = KNOWN_PERMISSION_COPY[name];
  if (known) return { name, source: 'known', ...known };

  const mcp = MCP_NAME.exec(name);
  if (mcp) {
    const server = mcp[1];
    const tool = prettifyPermissionName(mcp[2]);
    return {
      name,
      source: 'mcp',
      label: tool,
      detail: `Use the “${tool}” tool from the ${server} integration.`,
    };
  }

  return {
    name,
    source: 'fallback',
    label: prettifyPermissionName(name),
    detail: `Let HomeBot use its “${prettifyPermissionName(name).toLowerCase()}” capability.`,
  };
}

/** The machine-generated reason the batch executor attaches
 *  ("Requires permissions: x, y") duplicates the permission list the modal
 *  already renders with better copy — recognise it so the UI can skip it. */
export function isMachineReason(reason: string | undefined | null): boolean {
  if (!reason) return false;
  return /^requires permissions?\s*:/i.test(reason.trim());
}

/** A reason worth showing to a human, or null. Filters empty strings and
 *  the machine-generated permission enumeration. */
export function resolveHumanReason(reason: string | undefined | null): string | null {
  if (!reason) return null;
  const trimmed = reason.trim();
  if (!trimmed || isMachineReason(trimmed)) return null;
  return trimmed;
}

/** Honest, WCAG-friendly notice that the prompt auto-declines on timeout
 *  (permission-requester resolves 'expired' → deny). Rounded, not a live
 *  countdown — screen readers should not get per-second announcements. */
export function formatTimeoutNotice(timeoutMs: number | undefined | null): string {
  const DEFAULT_MS = 60000;
  const ms = typeof timeoutMs === 'number' && isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_MS;
  let approx: string;
  if (ms < 45000) {
    approx = `about ${Math.max(5, Math.round(ms / 5000) * 5)} seconds`;
  } else if (ms < 90000) {
    approx = 'about a minute';
  } else {
    approx = `about ${Math.round(ms / 60000)} minutes`;
  }
  return `No response within ${approx} declines the request automatically — nothing runs unless you allow it.`;
}
