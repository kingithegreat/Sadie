/**
 * The one way the renderer copies text to the clipboard.
 *
 * Before this existed, five call sites each did their own thing and none of
 * them worked. The app window runs sandboxed (`window-manager.ts` sets
 * `sandbox: true`), so the preload's `require('electron')` allowlist is only
 * [contextBridge, crashReporter, ipcRenderer, nativeImage, sharedTexture,
 * webFrame, webUtils] — no `clipboard`. The old preload called
 * `clipboard.writeText` directly, which threw
 * `TypeError: Cannot read properties of undefined (reading 'writeText')`, and
 * that throw crossed contextBridge **synchronously** into the renderer.
 *
 * `navigator.clipboard` is not a fallback here either: the app window's
 * permission handler (`window-manager.ts`) allows only `media`, `microphone`
 * and `audioCapture`, so clipboard writes are denied. Two call sites used it
 * anyway and silently rejected.
 *
 * So: go through `homebot:clipboard-write` in the main process, and return the
 * truth. Every caller should drive its "Copied" feedback off this boolean —
 * setting it unconditionally is what made a dead button look like a working
 * one, because the throw skipped the feedback instead of showing an error.
 *
 * @returns `true` only when the text actually reached the OS clipboard.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof text !== 'string') return false;
  try {
    const res = await window.electron?.writeClipboard?.(text);
    return res?.success === true;
  } catch (e) {
    console.error('Failed to copy to clipboard:', e);
    return false;
  }
}
