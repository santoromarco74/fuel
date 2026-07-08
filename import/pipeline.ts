// ============================================================
// FuelTracker — Pipeline di import (comune a tutti i profili)
//
// Ogni parser (CSV generico, backup JSON, Fuelio, Drivvo, ...)
// produce lo stesso formato intermedio normalizzato. Da lì:
//   validate() -> anteprima con errori riga per riga
//   commit()   -> scrittura tramite un Writer astratto
//
// Il Writer disaccoppia la pipeline dalla piattaforma:
//   - Android: implementazione sopra il DAL SQLite (passa
//     dall'outbox, quindi l'import funziona anche offline)
//   - Web: implementazione sopra il client Supabase
// ============================================================

import type { FuelType, Vehicle, Refuel } from '../types';

// ---------- Formato intermedio (output di ogni parser) ----------

export interface NormalizedVehicle {
  name: string;                 // chiave di matching con i veicoli esistenti
  make?: string | null;
  model?: string | null;
  plate?: string | null;
  fuel?: FuelType;
}

export interface NormalizedRefuel {
  vehicleName: string;          // riferimento per nome, risolto al commit
  refueledAt: string;           // ISO 8601
  odometerKm: number;
  liters: number;
  pricePerLiter: number;
  isFullTank: boolean;
  station?: string | null;
  notes?: string | null;
  sourceRow: number;            // riga del file d'origine (per gli errori)
}

export interface IntermediateImport {
  vehicles: NormalizedVehicle[];
  refuels: NormalizedRefuel[];
}

// ---------- Writer astratto ----------

export interface ImportWriter {
  listVehicles(): Promise<Vehicle[]>;
  listRefuels(vehicleId: string): Promise<Refuel[]>;
  insertVehicle(v: NormalizedVehicle): Promise<Vehicle>;
  insertRefuel(r: Omit<Refuel,
    'id' | 'user_id' | 'total_cost' | 'created_at' | 'updated_at' | 'deleted_at'
  >): Promise<void>;
}

// ---------- Validazione ----------

export interface RowError { row: number; message: string }

export interface ImportPreview {
  valid: NormalizedRefuel[];
  duplicates: NormalizedRefuel[];   // già presenti: verranno saltati
  errors: RowError[];               // righe scartate con motivo
  newVehicles: string[];            // veicoli da creare
  existingVehicles: string[];       // veicoli riconosciuti per nome
}

const dupKey = (vehicleName: string, dateDay: string, odo: number) =>
  `${vehicleName.toLowerCase()}|${dateDay}|${odo}`;

/**
 * Valida il formato intermedio contro i dati esistenti.
 * Non scrive nulla: produce l'anteprima da mostrare all'utente.
 */
export async function validate(
  data: IntermediateImport,
  writer: ImportWriter
): Promise<ImportPreview> {
  const errors: RowError[] = [];
  const valid: NormalizedRefuel[] = [];
  const duplicates: NormalizedRefuel[] = [];

  // indice dei rifornimenti esistenti per la dedup:
  // chiave (nome veicolo, giorno, odometro)
  const existing = await writer.listVehicles();
  const byName = new Map(existing.map((v) => [v.name.toLowerCase(), v]));
  const existingKeys = new Set<string>();
  for (const v of existing) {
    const rs = await writer.listRefuels(v.id);
    for (const r of rs) {
      existingKeys.add(dupKey(v.name, r.refueled_at.slice(0, 10), r.odometer_km));
    }
  }

  const seenInFile = new Set<string>();

  for (const r of data.refuels) {
    const problems: string[] = [];
    if (!r.vehicleName?.trim()) problems.push('veicolo mancante');
    if (!Number.isFinite(r.odometerKm) || r.odometerKm < 0) problems.push('chilometri non validi');
    if (!Number.isFinite(r.liters) || r.liters <= 0) problems.push('litri non validi');
    if (!Number.isFinite(r.pricePerLiter) || r.pricePerLiter < 0) problems.push('prezzo non valido');
    if (Number.isNaN(Date.parse(r.refueledAt))) problems.push('data non valida');

    if (problems.length > 0) {
      errors.push({ row: r.sourceRow, message: problems.join(', ') });
      continue;
    }

    const key = dupKey(r.vehicleName, r.refueledAt.slice(0, 10), r.odometerKm);
    if (existingKeys.has(key) || seenInFile.has(key)) {
      duplicates.push(r);
      continue;
    }
    seenInFile.add(key);
    valid.push(r);
  }

  const referenced = new Set(
    [...valid.map((r) => r.vehicleName), ...data.vehicles.map((v) => v.name)]
      .map((n) => n.trim())
      .filter(Boolean)
  );
  const newVehicles: string[] = [];
  const existingVehicles: string[] = [];
  for (const name of referenced) {
    (byName.has(name.toLowerCase()) ? existingVehicles : newVehicles).push(name);
  }

  return { valid, duplicates, errors, newVehicles, existingVehicles };
}

// ---------- Commit ----------

export interface ImportResult {
  vehiclesCreated: number;
  refuelsImported: number;
}

/**
 * Scrive i record validati. Da chiamare SOLO dopo che l'utente
 * ha confermato l'anteprima. I duplicati non arrivano qui.
 */
export async function commit(
  preview: ImportPreview,
  declaredVehicles: NormalizedVehicle[],
  writer: ImportWriter
): Promise<ImportResult> {
  const existing = await writer.listVehicles();
  const byName = new Map(existing.map((v) => [v.name.toLowerCase(), v]));
  const declared = new Map(
    declaredVehicles.map((v) => [v.name.toLowerCase(), v])
  );

  let vehiclesCreated = 0;

  // crea i veicoli mancanti (con i metadati dichiarati, se presenti)
  for (const name of preview.newVehicles) {
    const meta = declared.get(name.toLowerCase());
    const created = await writer.insertVehicle(meta ?? { name });
    byName.set(created.name.toLowerCase(), created);
    vehiclesCreated++;
  }

  // inserisci i rifornimenti in ordine di odometro: rende deterministico
  // il comportamento in caso di interruzione a metà import
  const sorted = [...preview.valid].sort((a, b) => a.odometerKm - b.odometerKm);
  let refuelsImported = 0;

  for (const r of sorted) {
    const vehicle = byName.get(r.vehicleName.trim().toLowerCase());
    if (!vehicle) continue; // non dovrebbe accadere dopo validate()
    await writer.insertRefuel({
      vehicle_id: vehicle.id,
      refueled_at: r.refueledAt,
      odometer_km: r.odometerKm,
      liters: r.liters,
      price_per_liter: r.pricePerLiter,
      is_full_tank: r.isFullTank,
      station: r.station ?? null,
      notes: r.notes ?? null,
    });
    refuelsImported++;
  }

  return { vehiclesCreated, refuelsImported };
}
