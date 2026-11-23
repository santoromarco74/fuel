// ============================================================
// FuelTracker — Backup su Google Drive (REST API v3)
//
// Struttura su Drive: cartella visibile "FuelTracker" nella
// radice, un file JSON per backup. Visibile di proposito:
// l'utente può vedere, scaricare o cancellare i suoi backup
// dal Drive senza passare dall'app.
//
// Politica: backup all'apertura dell'app se sono passati più di
// BACKUP_INTERVAL_DAYS dall'ultimo, più il pulsante manuale.
// (Il vero scheduling in background su Android/Expo è inaffidabile:
// questa è la versione robusta.)
// ============================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAccessToken } from './auth';
import { createBackup, backupFileName, type BackupFile } from '../import/backup';
import type { Vehicle, Refuel } from '../types';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_NAME = 'FuelTracker';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

const KEY_LAST_BACKUP = 'drive_last_backup_at';
const KEY_FOLDER_ID = 'drive_folder_id';
export const BACKUP_INTERVAL_DAYS = 7;
const KEEP_LAST_N = 10; // rotazione: conserva gli ultimi N backup

export type BackupOutcome =
  | { ok: true; fileName: string }
  | { ok: false; reason: 'not_connected' | 'network' | 'api'; detail?: string };

/** Il backup Drive esiste solo su Android (false in backup.web.ts). */
export const DRIVE_SUPPORTED = true;

// ---------- helpers HTTP ----------

async function driveFetch(
  token: string,
  url: string,
  init?: RequestInit
): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
}

// ---------- cartella FuelTracker ----------

async function getOrCreateFolder(token: string): Promise<string> {
  const cached = await AsyncStorage.getItem(KEY_FOLDER_ID);
  if (cached) {
    // verifica che esista ancora (l'utente può averla cestinata)
    const check = await driveFetch(
      token, `${DRIVE_API}/files/${cached}?fields=id,trashed`
    );
    if (check.ok) {
      const f = await check.json();
      if (!f.trashed) return cached;
    }
    await AsyncStorage.removeItem(KEY_FOLDER_ID);
  }

  const q = encodeURIComponent(
    `name = '${FOLDER_NAME}' and mimeType = '${FOLDER_MIME}' and trashed = false`
  );
  const search = await driveFetch(token, `${DRIVE_API}/files?q=${q}&fields=files(id)`);
  if (!search.ok) throw new Error(`Drive search: ${search.status}`);
  const found = (await search.json()).files?.[0]?.id as string | undefined;
  if (found) {
    await AsyncStorage.setItem(KEY_FOLDER_ID, found);
    return found;
  }

  const create = await driveFetch(token, `${DRIVE_API}/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
  });
  if (!create.ok) throw new Error(`Drive create folder: ${create.status}`);
  const id = (await create.json()).id as string;
  await AsyncStorage.setItem(KEY_FOLDER_ID, id);
  return id;
}

// ---------- upload multipart ----------

function multipartBody(
  metadata: object,
  content: string,
  boundary: string
): string {
  return [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    content,
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

async function uploadBackupFile(
  token: string,
  folderId: string,
  backup: BackupFile
): Promise<string> {
  const name = backupFileName();
  const boundary = `fueltracker_${Date.now()}`;
  const body = multipartBody(
    { name, parents: [folderId], mimeType: 'application/json' },
    JSON.stringify(backup),
    boundary
  );

  const res = await driveFetch(
    token,
    `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id`,
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    }
  );
  if (!res.ok) throw new Error(`Drive upload: ${res.status} ${await res.text()}`);
  return name;
}

// ---------- rotazione ----------

async function pruneOldBackups(token: string, folderId: string): Promise<void> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const res = await driveFetch(
    token,
    `${DRIVE_API}/files?q=${q}&orderBy=createdTime desc&fields=files(id,name)`
  );
  if (!res.ok) return; // la rotazione non deve mai far fallire il backup
  const files: { id: string }[] = (await res.json()).files ?? [];
  for (const f of files.slice(KEEP_LAST_N)) {
    await driveFetch(token, `${DRIVE_API}/files/${f.id}`, { method: 'DELETE' });
  }
}

// ---------- API pubbliche ----------

export async function backupNow(
  vehicles: Vehicle[],
  refuels: Refuel[]
): Promise<BackupOutcome> {
  const token = await getAccessToken();
  if (!token) return { ok: false, reason: 'not_connected' };

  try {
    const folderId = await getOrCreateFolder(token);
    const fileName = await uploadBackupFile(
      token, folderId, createBackup(vehicles, refuels)
    );
    await pruneOldBackups(token, folderId);
    await AsyncStorage.setItem(KEY_LAST_BACKUP, new Date().toISOString());
    return { ok: true, fileName };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    const reason = /Network|Failed to fetch/i.test(detail) ? 'network' : 'api';
    return { ok: false, reason, detail };
  }
}

/** Da chiamare all'avvio: esegue il backup solo se è "scaduto". */
export async function backupIfDue(
  loadData: () => Promise<{ vehicles: Vehicle[]; refuels: Refuel[] }>
): Promise<BackupOutcome | null> {
  if (!(await getAccessToken())) return null; // Drive non collegato: silenzio
  const last = await AsyncStorage.getItem(KEY_LAST_BACKUP);
  if (last) {
    const elapsed = Date.now() - Date.parse(last);
    if (elapsed < BACKUP_INTERVAL_DAYS * 86_400_000) return null;
  }
  const { vehicles, refuels } = await loadData();
  return backupNow(vehicles, refuels);
}

/** Data ISO dell'ultimo backup riuscito, o null. */
export async function getLastBackupAt(): Promise<string | null> {
  return AsyncStorage.getItem(KEY_LAST_BACKUP);
}

/** Elenco backup disponibili (per la schermata di restore). */
export async function listBackups(): Promise<
  { id: string; name: string; createdTime: string }[]
> {
  const token = await getAccessToken();
  if (!token) return [];
  const folderId = await getOrCreateFolder(token);
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const res = await driveFetch(
    token,
    `${DRIVE_API}/files?q=${q}&orderBy=createdTime desc&fields=files(id,name,createdTime)`
  );
  if (!res.ok) throw new Error(`Drive list: ${res.status}`);
  return (await res.json()).files ?? [];
}

/** Scarica il contenuto di un backup: da passare a parseBackupJson(). */
export async function downloadBackup(fileId: string): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new Error('Google Drive non collegato');
  const res = await driveFetch(token, `${DRIVE_API}/files/${fileId}?alt=media`);
  if (!res.ok) throw new Error(`Drive download: ${res.status}`);
  return res.text();
}
