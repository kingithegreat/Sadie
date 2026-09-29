/**
 * HomeBot stores automation instructions locally, while a generated n8n
 * workflow embeds a separate copy in its prompt. Until those copies can be
 * updated atomically, refuse edits that would claim the old workflow changed.
 */
export function automationEditConflict(
  current: { name: string; instructions: string; n8nWorkflowId?: string; n8nWebhookUrl?: string },
  edit: { name?: string; instructions?: string; n8nWebhookUrl?: string },
): string | undefined {
  if (current.n8nWorkflowId && edit.n8nWebhookUrl !== undefined &&
      edit.n8nWebhookUrl !== (current.n8nWebhookUrl || '')) {
    return 'This automation still owns an n8n workflow. Its webhook cannot be disconnected or replaced while that workflow remains active. Start n8n, delete the automation and its workflow, then create the revised version. If deletion fails, keep it.';
  }

  const changesPrompt =
    (edit.name !== undefined && edit.name !== current.name) ||
    (edit.instructions !== undefined && edit.instructions !== current.instructions);
  if (!changesPrompt || (!current.n8nWorkflowId && !current.n8nWebhookUrl)) return undefined;

  if (current.n8nWorkflowId) {
    return 'This automation has a deployed n8n workflow with its previous name and instructions. HomeBot cannot save these changes without leaving that workflow running the old version. Start n8n, delete the automation and its workflow, then create the revised version. If deletion fails, keep it.';
  }
  return 'This automation is linked to an n8n webhook that may still use its previous name and instructions. Disconnect the webhook first, then edit the local automation; manage the external workflow separately.';
}
