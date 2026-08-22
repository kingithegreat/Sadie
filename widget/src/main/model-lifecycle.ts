/**
 * Model lifecycle — retiring IDs without stranding the people who saved one.
 *
 * Provider model lists in custom-llm-client.ts get pruned as vendors retire
 * models, but a settings file written last year still names the retired ID.
 * Sending it returns a 404 on every request and the app looks broken. This
 * module is the bridge: a renamed model keeps working, mapped to whatever
 * currently fills its tier.
 *
 * Kept import-free on purpose: both config-manager (settings load) and
 * custom-llm-client (streaming) use it, and either importing the other would
 * create a cycle.
 */

/**
 * Exact renames first; a dated snapshot suffix is stripped and re-checked, so
 * `claude-3-5-sonnet-20241022` resolves through `claude-3-5-sonnet`.
 */
export const RETIRED_MODEL_RENAMES: Record<string, string> = {
  // OpenAI — turbo/gpt-4/3.5 were retired or made pointless by 4o/4o-mini.
  'gpt-4-turbo': 'gpt-4o',
  'gpt-4-turbo-preview': 'gpt-4o',
  'gpt-4': 'gpt-4o',
  'gpt-3.5-turbo': 'gpt-4o-mini',
  // Anthropic — Claude 3.x IDs are retired; aliases track the current tier.
  'claude-3-5-sonnet': 'claude-sonnet-5',
  'claude-3-5-haiku': 'claude-haiku-4-5',
  'claude-3-opus': 'claude-opus-5',
  'claude-3-sonnet': 'claude-sonnet-5',
  'claude-3-haiku': 'claude-haiku-4-5',
  'claude-opus-4': 'claude-opus-5',
  'claude-sonnet-4': 'claude-sonnet-5',
};

export interface ModelMigration {
  /** The model to actually use — the input unchanged when nothing migrated. */
  model: string;
  /** Set only when the input was retired and got renamed. */
  renamedFrom?: string;
}

/**
 * Map a retired model ID to its current-tier replacement.
 *
 * Idempotent: a current ID (including a previous migration's output) returns
 * unchanged, so running this on every settings load is safe. Unknown IDs also
 * pass through untouched — a custom endpoint's model names are not ours to
 * second-guess.
 */
export function migrateRetiredModel(model: string | undefined | null): ModelMigration {
  const raw = (model || '').trim();
  if (!raw) return { model: '' };

  const direct = RETIRED_MODEL_RENAMES[raw];
  if (direct) return { model: direct, renamedFrom: raw };

  // Dated snapshots: `claude-3-opus-20240229` → try `claude-3-opus`.
  const undated = raw.replace(/-\d{8}$/, '');
  if (undated !== raw) {
    const viaAlias = RETIRED_MODEL_RENAMES[undated];
    if (viaAlias) return { model: viaAlias, renamedFrom: raw };
  }

  return { model: raw };
}
