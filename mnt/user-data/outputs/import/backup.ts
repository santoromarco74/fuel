// ============================================================
// FuelTracker — Backup JSON: export + profilo di restore
//
// È il formato che finirà su Google Drive (punto 7). Contiene
// tutto ciò che serve per una ricostruzione fedele, versionato
// per poter evolvere senza rompere i backup vecchi.
// Il restore passa dalla stessa pipeline degli import (dedup
// inclusa): ripristinare su un DB non vuoto non duplica nulla.
// ============================================================

import type { Vehicle, Refuel } from '../types';
import type { IntermediateImport } from './pipeline';

export const BACKUP_VERSION = 1;

export interface BackupFile {
  app: 'fueltracker';
  version: number;
  exportedAt: string;             // ISO 8601
  vehicles: Vehicle[];
  refuels: Refuel[];
}

// ---------- Export ----------

export function createBackup(
  vehicles: Vehicle[],
  refuels: Refuel[]
): BackupFile {
  return {
    app: 'fueltracker',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    // i record soft-deleted non servono in un backup
    vehicles: vehicles.filter((v) => v.deleted_at === null),
    refuels: refuels.filter((r) => r.deleted_at === null),
  };
}

export const backupFileName = () =>
  `fueltracker-backup-${new Date().toISOString().slice(0, 10)}.json`;

// ---------- Restore (profilo di import) ----------

export function parseBackupJson(jsonText: string): IntermediateImport {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    throw new Error('Il file non è un JSON valido.');
  }
  const b = raw as Partial<BackupFile>;
  if (b.app !== 'fueltracker' || !Array.isArray(b.vehicles) || !Array.isArray(b.refuels)) {
    throw new Error('Il file non è un backup FuelTracker.');
  }
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) {
    throw new Error(
      `Backup versione ${b.version}: serve una versione più recente dell'app.`
    );
  }

  const vehicleName = new Map(b.vehicles.map((v) => [v.id, v.name]));

  return {
    vehicles: b.vehicles.map((v) => ({
      name: v.name,
      make: v.make,
      model: v.model,
      plate: v.plate,
      fuel: v.fuel,
    })),
    refuels: b.refuels.map((r, i) => ({
      vehicleName: vehicleName.get(r.vehicle_id) ?? '',
      refueledAt: r.refueled_at,
      odometerKm: r.odometer_km,
      liters: r.liters,
      pricePerLiter: r.price_per_liter,
      isFullTank: r.is_full_tank,
      station: r.station,
      notes: r.notes,
      sourceRow: i + 1,
    })),
  };
}
