// ============================================================
// FuelTracker — Schema SQLite locale (expo-sqlite)
// Speculare a schema.sql (Supabase), più le tabelle di sync.
// Differenze rispetto a Postgres:
//   - niente enum: fuel è TEXT con CHECK
//   - boolean come INTEGER 0/1
//   - timestamptz come TEXT ISO 8601 (UTC)
//   - total_cost calcolato dal DAL, non generato dal DB
//   - niente RLS: il DB locale appartiene al dispositivo
// ============================================================

import type { SQLiteDatabase } from 'expo-sqlite';

const SCHEMA_VERSION = 1;

const MIGRATION_V1 = `
CREATE TABLE IF NOT EXISTS vehicles (
  id                  TEXT PRIMARY KEY,          -- uuid client-side
  user_id             TEXT,
  name                TEXT NOT NULL,
  make                TEXT,
  model               TEXT,
  plate               TEXT,
  fuel                TEXT NOT NULL DEFAULT 'benzina'
                      CHECK (fuel IN ('benzina','diesel','gpl','metano','elettrico','ibrido')),
  initial_odometer_km REAL,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  deleted_at          TEXT
);

CREATE TABLE IF NOT EXISTS refuels (
  id              TEXT PRIMARY KEY,
  user_id         TEXT,
  vehicle_id      TEXT NOT NULL REFERENCES vehicles(id),
  refueled_at     TEXT NOT NULL,
  odometer_km     REAL NOT NULL CHECK (odometer_km >= 0),
  liters          REAL NOT NULL CHECK (liters > 0),
  price_per_liter REAL NOT NULL CHECK (price_per_liter >= 0),
  total_cost      REAL NOT NULL,
  is_full_tank    INTEGER NOT NULL DEFAULT 1 CHECK (is_full_tank IN (0,1)),
  station         TEXT,
  notes           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  deleted_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_refuels_vehicle
  ON refuels (vehicle_id, odometer_km);

-- ---------- Outbox: operazioni in attesa di push ----------
CREATE TABLE IF NOT EXISTS sync_queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name  TEXT NOT NULL CHECK (table_name IN ('vehicles','refuels')),
  operation   TEXT NOT NULL CHECK (operation IN ('insert','update','delete')),
  record_id   TEXT NOT NULL,
  payload     TEXT NOT NULL,                     -- JSON del record completo
  created_at  TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT
);

-- ---------- Stato di sync (riga singola) ----------
CREATE TABLE IF NOT EXISTS sync_state (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  last_pulled_at TEXT,
  last_push_at   TEXT
);
INSERT OR IGNORE INTO sync_state (id) VALUES (1);
`;

/**
 * Apre/aggiorna lo schema. Da chiamare una volta all'avvio:
 *   const db = await SQLite.openDatabaseAsync('fueltracker.db');
 *   await migrate(db);
 */
export async function migrate(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');

  const row = await db.getFirstAsync<{ user_version: number }>(
    'PRAGMA user_version;'
  );
  const current = row?.user_version ?? 0;

  if (current < 1) {
    await db.execAsync('BEGIN;');
    try {
      await db.execAsync(MIGRATION_V1);
      await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
      await db.execAsync('COMMIT;');
    } catch (e) {
      await db.execAsync('ROLLBACK;');
      throw e;
    }
  }
  // migrazioni future: if (current < 2) { ... }
}
