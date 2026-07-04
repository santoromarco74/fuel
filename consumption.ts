// ============================================================
// FuelTracker — Calcolo consumi in TypeScript
// Replica FEDELE della vista Postgres v_consumption (schema.sql),
// che resta la specifica di riferimento. Se una logica cambia,
// va cambiata in entrambi i posti.
//
// Funzioni pure: nessun accesso a DB o rete. Ricevono l'elenco
// rifornimenti (da SQLite su Android, da Supabase su web) e
// restituiscono segmenti e aggregati. Testabili in isolamento.
// ============================================================

import type { Refuel, ConsumptionSegment } from '../types';

const round = (n: number, d: number) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

/**
 * Segmenti di consumo tra pieni consecutivi.
 * Come nella vista SQL:
 *  - si ordina per ODOMETRO (non per data): un inserimento
 *    retroattivo non rompe i calcoli
 *  - i litri del segmento sommano TUTTI i rifornimenti
 *    (rabbocchi inclusi) con prev_odo < odo <= full_odo
 *  - segmenti con distanza <= 0 vengono scartati
 */
export function computeSegments(refuels: Refuel[]): ConsumptionSegment[] {
  const active = refuels
    .filter((r) => r.deleted_at === null)
    .sort((a, b) => a.odometer_km - b.odometer_km);

  const fullTanks = active.filter((r) => r.is_full_tank);
  const segments: ConsumptionSegment[] = [];

  for (let i = 1; i < fullTanks.length; i++) {
    const prev = fullTanks[i - 1];
    const curr = fullTanks[i];
    const distance = curr.odometer_km - prev.odometer_km;
    if (distance <= 0) continue;

    const inSegment = active.filter(
      (r) =>
        r.vehicle_id === curr.vehicle_id &&
        r.odometer_km > prev.odometer_km &&
        r.odometer_km <= curr.odometer_km
    );
    const liters = inSegment.reduce((s, r) => s + r.liters, 0);
    const cost = inSegment.reduce((s, r) => s + r.total_cost, 0);

    segments.push({
      id: curr.id,
      user_id: curr.user_id,
      vehicle_id: curr.vehicle_id,
      refueled_at: curr.refueled_at,
      odometer_km: curr.odometer_km,
      distance_km: distance,
      liters_consumed: round(liters, 2),
      km_per_liter: liters > 0 ? round(distance / liters, 2) : null,
      liters_per_100km: distance > 0 ? round((liters * 100) / distance, 2) : null,
      cost_per_km: distance > 0 ? round(cost / distance, 3) : null,
    });
  }
  return segments;
}

// ---------- Aggregati per la schermata statistiche ----------

export interface VehicleStats {
  segmentCount: number;
  totalDistanceKm: number;
  totalLiters: number;
  totalCost: number;          // costo dei soli segmenti misurabili
  avgKmPerLiter: number | null;      // media PONDERATA (km tot / litri tot)
  avgLitersPer100Km: number | null;
  avgCostPerKm: number | null;
  bestKmPerLiter: number | null;
  worstKmPerLiter: number | null;
  lastKmPerLiter: number | null;
}

export function computeStats(segments: ConsumptionSegment[]): VehicleStats {
  const km = segments.reduce((s, x) => s + x.distance_km, 0);
  const liters = segments.reduce((s, x) => s + x.liters_consumed, 0);
  const cost = segments.reduce(
    (s, x) => s + (x.cost_per_km ?? 0) * x.distance_km, 0
  );
  const kmls = segments
    .map((s) => s.km_per_liter)
    .filter((v): v is number => v !== null);

  return {
    segmentCount: segments.length,
    totalDistanceKm: round(km, 1),
    totalLiters: round(liters, 2),
    totalCost: round(cost, 2),
    // ponderata, non media delle medie: 100 km a 20 km/l e
    // 1000 km a 10 km/l NON fanno 15 km/l
    avgKmPerLiter: liters > 0 ? round(km / liters, 2) : null,
    avgLitersPer100Km: km > 0 ? round((liters * 100) / km, 2) : null,
    avgCostPerKm: km > 0 ? round(cost / km, 3) : null,
    bestKmPerLiter: kmls.length ? Math.max(...kmls) : null,
    worstKmPerLiter: kmls.length ? Math.min(...kmls) : null,
    lastKmPerLiter: kmls.length ? kmls[kmls.length - 1] : null,
  };
}

/** Spesa mensile (tutti i rifornimenti, anche fuori dai segmenti). */
export function monthlySpend(
  refuels: Refuel[]
): { month: string; total: number }[] {
  const map = new Map<string, number>();
  for (const r of refuels) {
    if (r.deleted_at !== null) continue;
    const month = r.refueled_at.slice(0, 7); // "2026-07"
    map.set(month, (map.get(month) ?? 0) + r.total_cost);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, total]) => ({ month, total: round(total, 2) }));
}
