// ============================================================
// FuelTracker — Writer concreto per la pipeline di import
//
// Un solo file per entrambe le piattaforme: si appoggia a
// db/dal, e Metro sceglie da solo dal.ts (SQLite+outbox) su
// Android e dal.web.ts (Supabase) sul web. Su Android quindi
// l'import passa dall'outbox e funziona anche offline.
// ============================================================

import {
  listVehicles, listRefuels, insertVehicle, insertRefuel,
} from '../db/dal';
import type { ImportWriter, NormalizedVehicle } from './pipeline';

type Db = Parameters<typeof listVehicles>[0];

export function makeImportWriter(db: Db, userId: string): ImportWriter {
  return {
    listVehicles: () => listVehicles(db),
    listRefuels: (vehicleId) => listRefuels(db, vehicleId),

    insertVehicle: (v: NormalizedVehicle) =>
      insertVehicle(db, {
        name: v.name.trim(),
        make: v.make ?? null,
        model: v.model ?? null,
        plate: v.plate ?? null,
        fuel: v.fuel ?? 'benzina',
        initial_odometer_km: null,
      }, userId),

    insertRefuel: async (r) => {
      await insertRefuel(db, {
        vehicle_id: r.vehicle_id,
        refueled_at: r.refueled_at,
        odometer_km: r.odometer_km,
        liters: r.liters,
        price_per_liter: r.price_per_liter,
        is_full_tank: r.is_full_tank,
        station: r.station,
        notes: r.notes,
      }, userId);
    },
  };
}
