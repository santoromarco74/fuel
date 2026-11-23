// ============================================================
// FuelTracker — Lettura file di testo (lib/readFile.ts)
//
// Nativo: expo-file-system (il picker copia il file nella cache,
// quindi l'uri è sempre leggibile). Sul web (readFile.web.ts) si
// usa fetch sull'uri blob del picker. Le schermate importano solo
// readTextFile: mai Platform.OS.
// ============================================================

import { File } from 'expo-file-system';

export async function readTextFile(uri: string): Promise<string> {
  return new File(uri).text();
}
