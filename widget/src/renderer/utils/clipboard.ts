/** Copy through the preload bridge and return the actual main-process result. */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof text !== 'string') return false;
  try {
    const result = await window.electron?.writeClipboard?.(text);
    return result?.success === true;
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    return false;
  }
}
