// ============================================================
// FuelTracker — Sync engine (solo Android; il web parla
// direttamente con Supabase)
//
// Strategia:
//   1. PUSH: svuota sync_queue in ordine FIFO verso Supabase.
//      - insert  -> upsert (idempotente: ri-eseguire non danneggia)
//      - update  -> update per id (last-write-wins)
//      - delete  -> update di deleted_at (soft delete)
//      Al primo errore si FERMA: l'ordine va preservato (un update
//      non può scavalcare l'insert fallito dello stesso record).
//      Il PULL viene comunque eseguito: un item bloccato non deve
//      impedire la ricezione dei dati degli altri record.
//   2. PULL: scarica i record con updated_at >= last_pulled_at
//      (deleted inclusi) e li applica in locale con upsert.
//      I record che hanno ancora operazioni in coda vengono
//      saltati: le modifiche locali non ancora pushate vincono.
//   3. last_pulled_at avanza al massimo updated_at RICEVUTO DAL
//      SERVER (mai l'orologio del telefono: clock skew).
//
// Trigger: riconnessione rete (NetInfo), app in foreground,
// chiamata manuale (pull-to-refresh). Single-flight: mai due
// sync concorrenti.
// ============================================================

import type { SQLiteDatabase } from 'expo-sqlite';
import type { SupabaseClient } from '@supabase/supabase-js';
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import type { SyncTable } from '../types';

const TABLES: SyncTable[] = ['vehicles', 'refuels'];
const MAX_ATTEMPTS = 8;

interface QueueRow {
  id: number;
  table_name: SyncTable;
  operation: 'insert' | 'update' | 'delete';
  record_id: string;
  payload: string;
  attempts: number;
}

export type SyncResult =
  | { ok: true; pushed: number; pulled: number }
  | { ok: false; pushed: number; pulled: number; error: string };

// ---------- PUSH ----------

async function pushQueue(
  db: SQLiteDatabase,
  supabase: SupabaseClient
): Promise<{ pushed: number; error?: string }> {
  const rows = await db.getAllAsync<QueueRow>(
    `SELECT id, table_name, operation, record_id, payload, attempts
     FROM sync_queue ORDER BY id ASC`
  );

  let pushed = 0;
  for (const row of rows) {
    const payload = JSON.parse(row.payload);
    let error: string | null = null;

    if (row.operation === 'insert') {
      const { error: e } = await supabase
        .from(row.table_name)
        .upsert(payload, { onConflict: 'id' });
      error = e?.message ?? null;
    } else {
      // update e delete sono entrambi update parziali per id
      const { error: e } = await supabase
        .from(row.table_name)
        .update(payload)
        .eq('id', row.record_id);
      error = e?.message ?? null;
    }

    if (error) {
      await db.runAsync(
        `UPDATE sync_queue SET attempts = attempts + 1, last_error = ?
         WHERE id = ?`,
        error, row.id
      );
      if (row.attempts + 1 >= MAX_ATTEMPTS) {
        // Non scartare mai dati dell'utente in silenzio: la UI
        // esporrà gli item "bloccati" (attempts >= MAX_ATTEMPTS)
        // per una risoluzione manuale.
        console.warn(`[sync] item ${row.id} bloccato: ${error}`);
      }
      return { pushed, error }; // stop: preserva l'ordine FIFO
    }

    await db.runAsync(`DELETE FROM sync_queue WHERE id = ?`, row.id);
    pushed++;
  }

  if (pushed > 0) {
    await db.runAsync(
      `UPDATE sync_state SET last_push_at = ? WHERE id = 1`,
      new Date().toISOString()
    );
  }
  return { pushed };
}

// ---------- PULL ----------

async function pullTable(
  db: SQLiteDatabase,
  supabase: SupabaseClient,
  table: SyncTable,
  since: string | null
): Promise<{ count: number; maxUpdatedAt: string | null }> {
  let query = supabase.from(table).select('*').order('updated_at');
  if (since) query = query.gte('updated_at', since);
  const { data, error } = await query;
  if (error) throw new Error(`pull ${table}: ${error.message}`);
  if (!data || data.length === 0) return { count: 0, maxUpdatedAt: null };

  // record con modifiche locali pendenti: non sovrascrivere
  const pending = await db.getAllAsync<{ record_id: string }>(
    `SELECT DISTINCT record_id FROM sync_queue WHERE table_name = ?`, table
  );
  const skip = new Set(pending.map((p) => p.record_id));

  let maxUpdatedAt: string | null = null;

  await db.withTransactionAsync(async () => {
    for (const r of data) {
      if (maxUpdatedAt === null || r.updated_at > maxUpdatedAt) {
        maxUpdatedAt = r.updated_at;
      }
      if (skip.has(r.id)) continue;

      const cols = Object.keys(r).filter((k) => k !== 'total_cost' || table === 'refuels');
      // upsert locale con ON CONFLICT DO UPDATE, non INSERT OR REPLACE:
      // REPLACE cancella e reinserisce la riga, e con le FK attive è
      // fragile — se refuels adottasse ON DELETE CASCADE (come già su
      // Postgres) il pull di un veicolo cancellerebbe i suoi
      // rifornimenti locali. DO UPDATE aggiorna sul posto.
      const placeholders = cols.map(() => '?').join(',');
      const updates = cols
        .filter((k) => k !== 'id')
        .map((k) => `${k} = excluded.${k}`)
        .join(', ');
      const values = cols.map((k) =>
        typeof r[k] === 'boolean' ? (r[k] ? 1 : 0) : r[k]
      );
      await db.runAsync(
        `INSERT INTO ${table} (${cols.join(',')})
         VALUES (${placeholders})
         ON CONFLICT(id) DO UPDATE SET ${updates}`,
        ...values
      );
    }
  });

  return { count: data.length, maxUpdatedAt };
}

// ---------- Orchestrazione ----------

let inFlight = false;

export async function syncNow(
  db: SQLiteDatabase,
  supabase: SupabaseClient
): Promise<SyncResult> {
  if (inFlight) return { ok: true, pushed: 0, pulled: 0 }; // già in corso
  inFlight = true;
  let pushed = 0;
  let pulled = 0;

  try {
    // 1. push prima del pull: la coda vuota elimina i conflitti
    const push = await pushQueue(db, supabase);
    pushed = push.pushed;

    // 2. pull incrementale. Si esegue ANCHE se il push si è fermato:
    //    i record con operazioni ancora in coda vengono comunque
    //    saltati dal pull (le modifiche locali vincono), quindi un
    //    item bloccato non impedisce la ricezione di tutto il resto.
    //    L'eventuale errore di push viene riportato in fondo.
    const state = await db.getFirstAsync<{ last_pulled_at: string | null }>(
      `SELECT last_pulled_at FROM sync_state WHERE id = 1`
    );
    const since = state?.last_pulled_at ?? null;

    let globalMax: string | null = since;
    for (const table of TABLES) {
      const { count, maxUpdatedAt } = await pullTable(db, supabase, table, since);
      pulled += count;
      if (maxUpdatedAt && (!globalMax || maxUpdatedAt > globalMax)) {
        globalMax = maxUpdatedAt;
      }
    }

    // 3. avanza il cursore SOLO se tutto è andato a buon fine.
    //    Si usa >= al prossimo giro: i record con lo stesso
    //    updated_at verranno riletti, ma l'upsert è idempotente.
    if (globalMax && globalMax !== since) {
      await db.runAsync(
        `UPDATE sync_state SET last_pulled_at = ? WHERE id = 1`,
        globalMax
      );
    }

    if (push.error) {
      return { ok: false, pushed, pulled, error: push.error };
    }
    return { ok: true, pushed, pulled };
  } catch (e) {
    return {
      ok: false, pushed, pulled,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    inFlight = false;
  }
}

/**
 * Registra i trigger automatici. Chiamare una volta nel layout root;
 * restituisce la funzione di cleanup per l'unmount.
 */
export function registerSyncTriggers(
  db: SQLiteDatabase,
  supabase: SupabaseClient,
  onResult?: (r: SyncResult) => void
): () => void {
  const run = () => syncNow(db, supabase).then((r) => onResult?.(r));

  const unsubNet = NetInfo.addEventListener((state) => {
    if (state.isConnected && state.isInternetReachable !== false) run();
  });

  const appStateSub = AppState.addEventListener('change', (s) => {
    if (s === 'active') run();
  });

  run(); // sync all'avvio

  return () => {
    unsubNet();
    appStateSub.remove();
  };
}

/** Item bloccati da mostrare in UI (attempts esauriti). */
export async function listStuckItems(db: SQLiteDatabase) {
  return db.getAllAsync<
    QueueRow & { last_error: string | null; created_at: string }
  >(
    `SELECT * FROM sync_queue WHERE attempts >= ? ORDER BY id ASC`,
    MAX_ATTEMPTS
  );
}

/**
 * Scarta un item bloccato dalla coda. Da chiamare SOLO su decisione
 * esplicita dell'utente (dalla UI degli item bloccati): il dato locale
 * resta com'è, ma la sua operazione non verrà mai pushata al server.
 */
export async function discardStuckItem(
  db: SQLiteDatabase,
  queueId: number
): Promise<void> {
  await db.runAsync(`DELETE FROM sync_queue WHERE id = ?`, queueId);
}
