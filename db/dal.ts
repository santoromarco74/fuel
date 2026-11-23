// ============================================================
// FuelTracker — Data Access Layer locale (Android, expo-sqlite)
// Regola fondamentale: OGNI scrittura su vehicles/refuels e il
// relativo inserimento in sync_queue avvengono nella STESSA
// transazione. O entrambi o nessuno: mai un dato locale senza
// la sua operazione in coda, mai un'operazione in coda senza dato.
//
// Il web NON usa questo modulo: parla direttamente con Supabase.
// ============================================================

import type { SQLiteDatabase } from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import type {
  Vehicle,
  VehicleInsert,
  VehicleUpdate,
  Refuel,
  RefuelInsert,
  RefuelUpdate,
  RefuelRowSqlite,
  SyncTable,
  SyncOperation,
} from '../types';
import { refuelFromSqlite } from '../types';

const nowIso = () => new Date().toISOString();
export const newId = () => Crypto.randomUUID();

// ---------- Outbox (privato) ----------

async function enqueue(
  db: SQLiteDatabase,
  table: SyncTable,
  op: SyncOperation,
  recordId: string,
  payload: unknown
): Promise<void> {
  await db.runAsync(
    `INSERT INTO sync_queue (table_name, operation, record_id, payload, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    table, op, recordId, JSON.stringify(payload), nowIso()
  );
}

// ---------- Vehicles ----------

export async function listVehicles(db: SQLiteDatabase): Promise<Vehicle[]> {
  return db.getAllAsync<Vehicle>(
    `SELECT * FROM vehicles WHERE deleted_at IS NULL ORDER BY name`
  );
}

export async function getVehicle(
  db: SQLiteDatabase,
  id: string
): Promise<Vehicle | null> {
  const row = await db.getFirstAsync<Vehicle>(
    `SELECT * FROM vehicles WHERE id = ?`, id
  );
  return row ?? null;
}

export async function insertVehicle(
  db: SQLiteDatabase,
  input: Omit<VehicleInsert, 'id'> & { id?: string },
  userId: string
): Promise<Vehicle> {
  const now = nowIso();
  const v: Vehicle = {
    id: input.id ?? newId(),
    user_id: userId,
    name: input.name,
    make: input.make ?? null,
    model: input.model ?? null,
    plate: input.plate ?? null,
    fuel: input.fuel,
    initial_odometer_km: input.initial_odometer_km ?? null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO vehicles
         (id, user_id, name, make, model, plate, fuel,
          initial_odometer_km, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      v.id, v.user_id, v.name, v.make, v.model, v.plate, v.fuel,
      v.initial_odometer_km, v.created_at, v.updated_at
    );
    await enqueue(db, 'vehicles', 'insert', v.id, v);
  });
  return v;
}

export async function updateVehicle(
  db: SQLiteDatabase,
  id: string,
  patch: VehicleUpdate
): Promise<void> {
  const keys = Object.keys(patch) as (keyof VehicleUpdate)[];
  if (keys.length === 0) return;
  const now = nowIso();

  await db.withTransactionAsync(async () => {
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    await db.runAsync(
      `UPDATE vehicles SET ${sets}, updated_at = ? WHERE id = ?`,
      ...keys.map((k) => patch[k] as never), now, id
    );
    await enqueue(db, 'vehicles', 'update', id, {
      ...patch,
      updated_at: now,
    });
  });
}

export async function deleteVehicle(
  db: SQLiteDatabase,
  id: string
): Promise<void> {
  const now = nowIso();
  await db.withTransactionAsync(async () => {
    // soft delete a cascata anche sui rifornimenti del veicolo
    await db.runAsync(
      `UPDATE vehicles SET deleted_at = ?, updated_at = ? WHERE id = ?`,
      now, now, id
    );
    const refuels = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM refuels WHERE vehicle_id = ? AND deleted_at IS NULL`, id
    );
    await db.runAsync(
      `UPDATE refuels SET deleted_at = ?, updated_at = ?
       WHERE vehicle_id = ? AND deleted_at IS NULL`,
      now, now, id
    );
    await enqueue(db, 'vehicles', 'delete', id, { deleted_at: now, updated_at: now });
    for (const r of refuels) {
      await enqueue(db, 'refuels', 'delete', r.id, { deleted_at: now, updated_at: now });
    }
  });
}

// ---------- Refuels ----------

export async function listRefuels(
  db: SQLiteDatabase,
  vehicleId: string
): Promise<Refuel[]> {
  const rows = await db.getAllAsync<RefuelRowSqlite>(
    `SELECT * FROM refuels
     WHERE vehicle_id = ? AND deleted_at IS NULL
     ORDER BY odometer_km DESC`,
    vehicleId
  );
  return rows.map(refuelFromSqlite);
}

export async function getRefuel(
  db: SQLiteDatabase,
  id: string
): Promise<Refuel | null> {
  const row = await db.getFirstAsync<RefuelRowSqlite>(
    `SELECT * FROM refuels WHERE id = ?`, id
  );
  return row ? refuelFromSqlite(row) : null;
}

export async function insertRefuel(
  db: SQLiteDatabase,
  input: Omit<RefuelInsert, 'id'> & { id?: string },
  userId: string
): Promise<Refuel> {
  const now = nowIso();
  const r: Refuel = {
    id: input.id ?? newId(),
    user_id: userId,
    vehicle_id: input.vehicle_id,
    refueled_at: input.refueled_at,
    odometer_km: input.odometer_km,
    liters: input.liters,
    price_per_liter: input.price_per_liter,
    total_cost: Math.round(input.liters * input.price_per_liter * 100) / 100,
    is_full_tank: input.is_full_tank,
    station: input.station ?? null,
    notes: input.notes ?? null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO refuels
         (id, user_id, vehicle_id, refueled_at, odometer_km, liters,
          price_per_liter, total_cost, is_full_tank, station, notes,
          created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      r.id, r.user_id, r.vehicle_id, r.refueled_at, r.odometer_km, r.liters,
      r.price_per_liter, r.total_cost, r.is_full_tank ? 1 : 0, r.station,
      r.notes, r.created_at, r.updated_at
    );
    // Nel payload verso Supabase total_cost NON va inviato (colonna generata)
    const { total_cost: _omit, ...payload } = r;
    await enqueue(db, 'refuels', 'insert', r.id, payload);
  });
  return r;
}

export async function updateRefuel(
  db: SQLiteDatabase,
  id: string,
  patch: RefuelUpdate
): Promise<void> {
  const keys = Object.keys(patch) as (keyof RefuelUpdate)[];
  if (keys.length === 0) return;
  const now = nowIso();

  await db.withTransactionAsync(async () => {
    // se cambiano litri o prezzo, ricalcola total_cost locale
    const current = await db.getFirstAsync<RefuelRowSqlite>(
      `SELECT * FROM refuels WHERE id = ?`, id
    );
    if (!current) throw new Error(`Refuel ${id} non trovato`);

    const liters = patch.liters ?? current.liters;
    const ppl = patch.price_per_liter ?? current.price_per_liter;
    const totalCost = Math.round(liters * ppl * 100) / 100;

    const sets = keys.map((k) => `${k} = ?`).join(', ');
    const values = keys.map((k) =>
      k === 'is_full_tank' ? (patch[k] ? 1 : 0) : (patch[k] as never)
    );
    await db.runAsync(
      `UPDATE refuels SET ${sets}, total_cost = ?, updated_at = ? WHERE id = ?`,
      ...values, totalCost, now, id
    );
    await enqueue(db, 'refuels', 'update', id, { ...patch, updated_at: now });
  });
}

export async function deleteRefuel(
  db: SQLiteDatabase,
  id: string
): Promise<void> {
  const now = nowIso();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE refuels SET deleted_at = ?, updated_at = ? WHERE id = ?`,
      now, now, id
    );
    await enqueue(db, 'refuels', 'delete', id, { deleted_at: now, updated_at: now });
  });
}

// ---------- Utilità per il sync engine (punto 4) ----------

export async function pendingCount(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sync_queue`
  );
  return row?.n ?? 0;
}
