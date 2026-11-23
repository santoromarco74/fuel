// ============================================================
// FuelTracker — OAuth Google, versione WEB (drive/auth.web.ts)
// Il backup Drive è solo Android per scelta di progetto (il web
// legge già tutto da Supabase). No-op con la stessa API, così
// nessuna schermata ha bisogno di Platform.OS e il bundle web
// non trascina expo-secure-store / expo-auth-session.
// ============================================================

export async function connectDrive(): Promise<boolean> {
  return false;
}

export async function disconnectDrive(): Promise<void> {}

export async function isDriveConnected(): Promise<boolean> {
  return false;
}

export async function getAccessToken(): Promise<string | null> {
  return null;
}
