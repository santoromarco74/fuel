// ============================================================
// FuelTracker — Backup Drive, versione WEB (drive/backup.web.ts)
// No-op: il backup esiste solo su Android. Stessa API del
// modulo nativo; import di tipi soltanto (si cancellano in
// compilazione, il bundle web resta pulito).
// ============================================================

import type { Vehicle, Refuel } from '../types';
import type { BackupOutcome } from './backup';
export type { BackupOutcome };

export const DRIVE_SUPPORTED = false;

// tenuto uguale al valore nativo: serve solo per i testi in UI
export const BACKUP_INTERVAL_DAYS = 7;

export async function backupNow(
  _vehicles: Vehicle[],
  _refuels: Refuel[]
): Promise<BackupOutcome> {
  return { ok: false, reason: 'not_connected' };
}

export async function backupIfDue(
  _loadData: () => Promise<{ vehicles: Vehicle[]; refuels: Refuel[] }>
): Promise<BackupOutcome | null> {
  return null;
}

export async function getLastBackupAt(): Promise<string | null> {
  return null;
}

export async function listBackups(): Promise<
  { id: string; name: string; createdTime: string }[]
> {
  return [];
}

export async function downloadBackup(_fileId: string): Promise<string> {
  throw new Error('Il backup Google Drive non è disponibile sul web.');
}
