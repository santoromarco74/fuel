// ============================================================
// FuelTracker — Sync engine versione WEB (sync/engine.web.ts)
// Sul web non c'è nulla da sincronizzare: le scritture vanno
// direttamente su Supabase. No-op con la stessa API, così il
// layout root può chiamare registerSyncTriggers senza Platform.OS.
// ============================================================

import type { SyncResult } from './engine';
export type { SyncResult };

export async function syncNow(): Promise<SyncResult> {
  return { ok: true, pushed: 0, pulled: 0 };
}

export function registerSyncTriggers(): () => void {
  return () => {};
}

export async function listStuckItems(): Promise<never[]> {
  return [];
}
