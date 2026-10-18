/** Copies text; resolves false when the webview refuses (callers show the outcome). */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
