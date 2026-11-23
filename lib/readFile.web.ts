// ============================================================
// FuelTracker — Lettura file di testo, versione WEB
// L'uri del document picker sul web è un blob/data URI: fetch
// lo legge direttamente, niente expo-file-system nel bundle.
// ============================================================

export async function readTextFile(uri: string): Promise<string> {
  const res = await fetch(uri);
  return res.text();
}
