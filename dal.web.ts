// ============================================================
// FuelTracker — DAL versione WEB (db/dal.web.ts)
//
// Metro risolve automaticamente l'estensione .web.ts quando si
// compila per il web: gli import `from '../db/dal'` restano
// identici nelle schermate, ma qui l'implementazione parla
// direttamente con Supabase. Niente SQLite, niente outbox:
// il web è sempre online per definizione del progetto.
//
// Il parametro `db` esiste solo per compatibilità di firma
// con la versione nativa e viene ignorato.
// ============================================================

import { supabase } from '../lib/supabase'; // client condiviso
import type {
  Vehicle, VehicleInsert, VehicleUpdate,
  Refuel, RefuelInsert, RefuelUpdate,
} from '../types';

export const newId = () => crypto.randomUUID();

type AnyDb = unknown;

// ---------- Vehicles ----------

export async function listVehicles(_db: AnyDb): Promise<Vehicle[]> {
  const { data, error } = await supabase
    .from('vehicles').select('*')
    .is('deleted_at', null)
    .order('name');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function insertVehicle(
  _db: AnyDb,
  input: Omit<VehicleInsert, 'id'> & { id?: string },
  _userId: string // su web lo mette il default auth.uid() lato server
): Promise<Vehicle> {
  const payload = { ...input, id: input.id ?? newId() };
  const { data, error } = await supabase
    .from('vehicles').insert(payload).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateVehicle(
  _db: AnyDb, id: string, patch: VehicleUpdate
): Promise<void> {
  const { error } = await supabase.from('vehicles').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteVehicle(_db: AnyDb, id: string): Promise<void> {
  const now = new Date().toISOString();
  // stessa semantica della versione nativa: soft delete a cascata
  const { error: e1 } = await supabase
    .from('vehicles').update({ deleted_at: now }).eq('id', id);
  if (e1) throw new Error(e1.message);
  const { error: e2 } = await supabase
    .from('refuels').update({ deleted_at: now })
    .eq('vehicle_id', id).is('deleted_at', null);
  if (e2) throw new Error(e2.message);
}

// ---------- Refuels ----------

export async function listRefuels(
  _db: AnyDb, vehicleId: string
): Promise<Refuel[]> {
  const { data, error } = await supabase
    .from('refuels').select('*')
    .eq('vehicle_id', vehicleId)
    .is('deleted_at', null)
    .order('odometer_km', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function insertRefuel(
  _db: AnyDb,
  input: Omit<RefuelInsert, 'id'> & { id?: string },
  _userId: string
): Promise<Refuel> {
  // total_cost NON si invia: è colonna generata
  const payload = { ...input, id: input.id ?? newId() };
  const { data, error } = await supabase
    .from('refuels').insert(payload).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateRefuel(
  _db: AnyDb, id: string, patch: RefuelUpdate
): Promise<void> {
  const { error } = await supabase.from('refuels').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteRefuel(_db: AnyDb, id: string): Promise<void> {
  const { error } = await supabase
    .from('refuels')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

// ---------- compatibilità di firma con la versione nativa ----------

export async function pendingCount(_db: AnyDb): Promise<number> {
  return 0; // sul web non esiste una coda: tutto è già sincrono
}
