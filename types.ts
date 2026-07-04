// ============================================================
// FuelTracker — Tipi TypeScript
// Speculari allo schema Supabase (schema.sql).
// Le stesse interfacce valgono per le righe SQLite locali:
// in SQLite i timestamptz sono stringhe ISO 8601, i boolean 0/1
// (vedi i convertitori in fondo al file).
// ============================================================

export type FuelType =
  | 'benzina'
  | 'diesel'
  | 'gpl'
  | 'metano'
  | 'elettrico'
  | 'ibrido';

// ---------- Righe delle tabelle (come arrivano da Supabase) ----------

export interface Vehicle {
  id: string;                       // uuid generato client-side
  user_id: string;
  name: string;
  make: string | null;
  model: string | null;
  plate: string | null;
  fuel: FuelType;
  initial_odometer_km: number | null;
  created_at: string;               // ISO 8601
  updated_at: string;
  deleted_at: string | null;        // soft delete
}

export interface Refuel {
  id: string;
  user_id: string;
  vehicle_id: string;
  refueled_at: string;
  odometer_km: number;
  liters: number;
  price_per_liter: number;
  total_cost: number;               // colonna generata lato DB
  is_full_tank: boolean;
  station: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// Riga della vista v_consumption
export interface ConsumptionSegment {
  id: string;                       // id del pieno che chiude il tratto
  user_id: string;
  vehicle_id: string;
  refueled_at: string;
  odometer_km: number;
  distance_km: number;
  liters_consumed: number;
  km_per_liter: number | null;
  liters_per_100km: number | null;
  cost_per_km: number | null;
}

// ---------- Payload di insert/update (lato client) ----------
// total_cost è generato dal DB, user_id dal default auth.uid():
// non vanno mai inviati.

export type VehicleInsert = Omit<
  Vehicle,
  'user_id' | 'created_at' | 'updated_at' | 'deleted_at'
> & {
  id: string;                       // sempre esplicito: uuid client-side
};

export type VehicleUpdate = Partial<
  Omit<Vehicle, 'id' | 'user_id' | 'created_at' | 'updated_at'>
>;

export type RefuelInsert = Omit<
  Refuel,
  'user_id' | 'total_cost' | 'created_at' | 'updated_at' | 'deleted_at'
> & {
  id: string;
};

export type RefuelUpdate = Partial<
  Omit<Refuel, 'id' | 'user_id' | 'total_cost' | 'created_at' | 'updated_at'>
>;

// ---------- Sync (outbox pattern) ----------

export type SyncTable = 'vehicles' | 'refuels';
export type SyncOperation = 'insert' | 'update' | 'delete';

/** Riga della tabella locale sync_queue (solo SQLite, mai su Supabase). */
export interface SyncQueueItem {
  id: number;                       // autoincrement locale
  table_name: SyncTable;
  operation: SyncOperation;
  record_id: string;                // uuid del record interessato
  payload: string;                  // JSON serializzato dell'operazione
  created_at: string;
  attempts: number;                 // tentativi falliti (per backoff)
  last_error: string | null;
}

/** Stato di sync persistito localmente (es. tabella sync_state a 1 riga). */
export interface SyncState {
  last_pulled_at: string | null;    // updated_at massimo ricevuto dal server
  last_push_at: string | null;
  pending_count: number;
}

// ---------- Convertitori SQLite <-> TS ----------
// SQLite non ha boolean: is_full_tank è 0/1 nelle righe locali.

export interface RefuelRowSqlite extends Omit<Refuel, 'is_full_tank'> {
  is_full_tank: 0 | 1;
}

export const refuelFromSqlite = (row: RefuelRowSqlite): Refuel => ({
  ...row,
  is_full_tank: row.is_full_tank === 1,
});

export const refuelToSqlite = (r: Refuel): RefuelRowSqlite => ({
  ...r,
  is_full_tank: r.is_full_tank ? 1 : 0,
});
