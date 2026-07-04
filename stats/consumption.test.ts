// Verifica computeSegments/computeStats contro valori attesi calcolati a mano.
// Scenario: 3 pieni + 1 rabbocco intermedio + 1 record cancellato.
import { computeSegments, computeStats, monthlySpend } from './consumption';
import type { Refuel } from '../types';

const mk = (p: Partial<Refuel> & Pick<Refuel, 'id' | 'odometer_km' | 'liters' | 'price_per_liter' | 'is_full_tank'>): Refuel => ({
  user_id: 'u1', vehicle_id: 'v1',
  refueled_at: p.refueled_at ?? '2026-01-01T08:00:00Z',
  total_cost: Math.round(p.liters * p.price_per_liter * 100) / 100,
  station: null, notes: null,
  created_at: '', updated_at: '', deleted_at: null,
  ...p,
});

const refuels: Refuel[] = [
  mk({ id: 'a', odometer_km: 10000, liters: 40, price_per_liter: 1.8, is_full_tank: true,  refueled_at: '2026-01-05T08:00:00Z' }),
  // rabbocco intermedio: 10 litri
  mk({ id: 'b', odometer_km: 10300, liters: 10, price_per_liter: 1.9, is_full_tank: false, refueled_at: '2026-01-20T08:00:00Z' }),
  // pieno che chiude il segmento 1: 35 litri
  mk({ id: 'c', odometer_km: 10600, liters: 35, price_per_liter: 1.8, is_full_tank: true,  refueled_at: '2026-02-02T08:00:00Z' }),
  // record cancellato: deve essere ignorato
  mk({ id: 'x', odometer_km: 10700, liters: 99, price_per_liter: 9.9, is_full_tank: true,  deleted_at: '2026-02-03T00:00:00Z' }),
  // pieno che chiude il segmento 2: 30 litri
  mk({ id: 'd', odometer_km: 11100, liters: 30, price_per_liter: 2.0, is_full_tank: true,  refueled_at: '2026-02-15T08:00:00Z' }),
];

const seg = computeSegments(refuels);

// Attesi (a mano):
// Segmento 1 (a -> c): 600 km, litri = 10 + 35 = 45, km/l = 13.33,
//   l/100km = 7.5, costo = 10*1.9 + 35*1.8 = 19 + 63 = 82, €/km = 0.137
// Segmento 2 (c -> d): 500 km, litri = 30, km/l = 16.67,
//   l/100km = 6, costo = 60, €/km = 0.12
const assert = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'OK ' : 'FAIL'} ${label}: got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  if (!ok) process.exitCode = 1;
};

assert('n segmenti', seg.length, 2);
assert('seg1 distanza', seg[0].distance_km, 600);
assert('seg1 litri (rabbocco incluso)', seg[0].liters_consumed, 45);
assert('seg1 km/l', seg[0].km_per_liter, 13.33);
assert('seg1 l/100km', seg[0].liters_per_100km, 7.5);
assert('seg1 €/km', seg[0].cost_per_km, 0.137);
assert('seg2 distanza', seg[1].distance_km, 500);
assert('seg2 km/l', seg[1].km_per_liter, 16.67);
assert('seg2 €/km', seg[1].cost_per_km, 0.12);

const stats = computeStats(seg);
// media ponderata: 1100 km / 75 l = 14.67 (NON (13.33+16.67)/2 = 15)
assert('media ponderata km/l', stats.avgKmPerLiter, 14.67);
assert('best km/l', stats.bestKmPerLiter, 16.67);
assert('totale km', stats.totalDistanceKm, 1100);

const spend = monthlySpend(refuels);
// gen: 72 + 19 = 91 ; feb: 63 + 60 = 123 (il cancellato è escluso)
assert('spesa gennaio', spend[0], { month: '2026-01', total: 91 });
assert('spesa febbraio', spend[1], { month: '2026-02', total: 123 });

// ---- Partizione per veicolo (come "partition by vehicle_id" in SQL) ----
// I pieni di v2 hanno odometri più bassi di quelli di v1: senza
// partizione verrebbero accoppiati in sequenza globale, creando un
// segmento fantasma v2->v1 (4 segmenti invece di 3).
const v2: Refuel[] = [
  mk({ id: 'e', vehicle_id: 'v2', odometer_km: 5000, liters: 38, price_per_liter: 1.7, is_full_tank: true, refueled_at: '2026-01-10T08:00:00Z' }),
  mk({ id: 'f', vehicle_id: 'v2', odometer_km: 5400, liters: 20, price_per_liter: 1.7, is_full_tank: true, refueled_at: '2026-01-25T08:00:00Z' }),
];
const mixed = computeSegments([...refuels, ...v2]);
assert('mix due veicoli: nessun segmento incrociato', mixed.length, 3);
const segV2 = mixed.filter((s) => s.vehicle_id === 'v2');
assert('mix due veicoli: segmento di v2 corretto',
  [segV2.length, segV2[0]?.distance_km, segV2[0]?.liters_consumed],
  [1, 400, 20]);
