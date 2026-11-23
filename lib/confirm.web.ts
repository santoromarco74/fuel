// ============================================================
// FuelTracker — Conferma modale, versione WEB (lib/confirm.web.ts)
// Alert di react-native-web è un no-op: si usa window.confirm.
// ============================================================

export async function confirmAsync(
  title: string,
  message: string,
  _confirmLabel = 'OK',
  _destructive = false
): Promise<boolean> {
  return window.confirm(`${title}\n\n${message}`);
}
