// Test end-to-end: CSV "sporco" realistico -> parser generico ->
// validate -> commit su un writer in memoria. Verifica numeri
// europei, date dd/mm, righe invalide, duplicati e derivazione
// del prezzo dal costo totale.
import { parseGenericCsv, parseEuNumber, parseEuDate } from './genericCsv';
import { validate, commit, type ImportWriter, type NormalizedVehicle } from './pipeline';
import type { Vehicle, Refuel } from '../types';

let failures = 0;
const assert = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'OK ' : 'FAIL'} ${label}: got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  if (!ok) failures++;
};

// ---------- unit: parsing ----------
assert('num "1.234,56"', parseEuNumber('1.234,56'), 1234.56);
assert('num "1234.56"', parseEuNumber('1234.56'), 1234.56);
assert('num "1,789 €"', parseEuNumber('1,789 €'), 1.789);
assert('num vuoto -> NaN', Number.isNaN(parseEuNumber('')), true);
assert('data 31/12/2025', parseEuDate('31/12/2025')?.slice(0, 10), '2025-12-31');
assert('data 2025-12-31', parseEuDate('2025-12-31')?.slice(0, 10), '2025-12-31');
assert('data 32/13/2025 -> null', parseEuDate('32/13/2025'), null);

// ---------- e2e ----------
const csv = [
  'Data;Km;Litri;Costo totale;Pieno',
  '05/01/2026;10000;40,00;72,00;si',
  '20/01/2026;10300;10,00;19,00;no',
  '02/02/2026;10600;35,00;63,00;si',
  'data-rotta;10700;5;9;si',            // riga invalida (data)
  '02/02/2026;10600;35,00;63,00;si',    // duplicato interno al file
].join('\n');

// PapaParse rileva il delimitatore ';' automaticamente
const parsed = parseGenericCsv(csv, {
  mapping: {
    date: 'Data', odometerKm: 'Km', liters: 'Litri',
    totalCost: 'Costo totale', isFullTank: 'Pieno',
  },
  defaultVehicle: 'Panda',
});

assert('righe parse', parsed.refuels.length, 5);
assert('prezzo derivato da totale', parsed.refuels[0].pricePerLiter, 1.8);
assert('pieno "no"', parsed.refuels[1].isFullTank, false);

// writer in memoria con un rifornimento GIÀ esistente (dup esterno)
const vehicles: Vehicle[] = [{
  id: 'v1', user_id: 'u1', name: 'Panda', make: null, model: null,
  plate: null, fuel: 'benzina', initial_odometer_km: null,
  created_at: '', updated_at: '', deleted_at: null,
}];
const refuels: Refuel[] = [{
  id: 'r0', user_id: 'u1', vehicle_id: 'v1',
  refueled_at: '2026-01-05T09:00:00Z', odometer_km: 10000,
  liters: 40, price_per_liter: 1.8, total_cost: 72, is_full_tank: true,
  station: null, notes: null, created_at: '', updated_at: '', deleted_at: null,
}];

const writer: ImportWriter = {
  listVehicles: async () => vehicles,
  listRefuels: async (id) => refuels.filter((r) => r.vehicle_id === id),
  insertVehicle: async (v: NormalizedVehicle) => {
    const created: Vehicle = {
      id: `v${vehicles.length + 1}`, user_id: 'u1', name: v.name,
      make: v.make ?? null, model: v.model ?? null, plate: v.plate ?? null,
      fuel: v.fuel ?? 'benzina', initial_odometer_km: null,
      created_at: '', updated_at: '', deleted_at: null,
    };
    vehicles.push(created);
    return created;
  },
  insertRefuel: async (r) => {
    refuels.push({
      ...r, id: `r${refuels.length}`, user_id: 'u1',
      total_cost: Math.round(r.liters * r.price_per_liter * 100) / 100,
      created_at: '', updated_at: '', deleted_at: null,
    });
  },
};

(async () => {
  const preview = await validate(parsed, writer);
  assert('errori (data rotta)', preview.errors.length, 1);
  assert('errore riga giusta', preview.errors[0].row, 5);
  // dup: 1 esterno (05/01 già nel DB) + 1 interno al file
  assert('duplicati', preview.duplicates.length, 2);
  assert('validi', preview.valid.length, 2);
  assert('veicolo riconosciuto', preview.existingVehicles, ['Panda']);
  assert('nessun veicolo nuovo', preview.newVehicles, []);

  const result = await commit(preview, parsed.vehicles, writer);
  assert('importati', result.refuelsImported, 2);
  assert('veicoli creati', result.vehiclesCreated, 0);
  assert('totale rifornimenti nel DB', refuels.length, 3);

  // idempotenza: ri-importare lo stesso file non deve aggiungere nulla
  const preview2 = await validate(parsed, writer);
  assert('re-import: 0 validi', preview2.valid.length, 0);
  assert('re-import: tutti duplicati', preview2.duplicates.length, 4);

  process.exit(failures > 0 ? 1 : 0);
})();
