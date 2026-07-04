// ============================================================
// FuelTracker — Profilo di import: CSV generico con mappatura
//
// L'utente carica un CSV qualsiasi, la UI mostra le intestazioni
// trovate e lui le associa ai campi. Questo modulo fa il resto.
// Parsing con PapaParse (identico su React Native e web).
//
// Gestisce i formati reali dei fogli di calcolo italiani:
//   numeri:  "1.234,56" | "1234,56" | "1234.56"
//   date:    "31/12/2025" | "31-12-2025" | "2025-12-31" | ISO completo
// ============================================================

import Papa from 'papaparse';
import type { IntermediateImport, NormalizedRefuel } from './pipeline';

// ---------- Mappatura colonne (decisa dall'utente in UI) ----------

export interface ColumnMapping {
  vehicleName?: string;   // nome colonna, oppure undefined + defaultVehicle
  date: string;
  odometerKm: string;
  liters: string;
  /** una delle due: prezzo/litro oppure costo totale (si deriva l'altro) */
  pricePerLiter?: string;
  totalCost?: string;
  isFullTank?: string;    // colonna booleana; assente = tutto pieno
  station?: string;
  notes?: string;
}

export interface GenericCsvOptions {
  mapping: ColumnMapping;
  /** usato quando il file non ha la colonna veicolo */
  defaultVehicle?: string;
}

// ---------- Parsing valori ----------

/** "1.234,56" -> 1234.56 ; "1234.56" -> 1234.56 ; "1234,56" -> 1234.56 */
export function parseEuNumber(raw: string | undefined): number {
  if (raw === undefined) return NaN;
  let s = raw.trim().replace(/[€\s]/g, '');
  if (s === '') return NaN;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) {
    // virgola decimale: i punti sono separatori delle migliaia
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    // punto decimale: le virgole sono separatori delle migliaia
    s = s.replace(/,/g, '');
  }
  return Number(s);
}

/** Ritorna ISO 8601 o null. Ambiguità dd/mm vs mm/dd: si assume dd/mm. */
export function parseEuDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();

  // ISO (con o senza ora): lascialo fare a Date.parse
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }

  // dd/mm/yyyy o dd-mm-yyyy, ora opzionale
  const m = s.match(
    /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:[ T](\d{1,2}):(\d{2}))?$/
  );
  if (!m) return null;
  const [, dd, mm, yyyy, hh = '12', min = '00'] = m;
  const d = new Date(Date.UTC(+yyyy, +mm - 1, +dd, +hh, +min));
  // rifiuta date "arrotolate" tipo 32/13/2025
  if (d.getUTCDate() !== +dd || d.getUTCMonth() !== +mm - 1) return null;
  return d.toISOString();
}

const TRUTHY = new Set(['1', 'true', 'si', 'sì', 'yes', 'x', 'pieno', 'full']);
export function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return fallback;
  return TRUTHY.has(raw.trim().toLowerCase());
}

// ---------- Lettura intestazioni (per la UI di mappatura) ----------

export function readCsvHeaders(csvText: string): string[] {
  const res = Papa.parse<string[]>(csvText, { preview: 1, skipEmptyLines: true });
  return (res.data[0] ?? []).map((h) => String(h).trim());
}

// ---------- Parser ----------

export function parseGenericCsv(
  csvText: string,
  opts: GenericCsvOptions
): IntermediateImport {
  const { mapping, defaultVehicle } = opts;
  const res = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const refuels: NormalizedRefuel[] = [];

  res.data.forEach((row, i) => {
    const sourceRow = i + 2; // 1-based + riga di intestazione

    const liters = parseEuNumber(row[mapping.liters]);
    let pricePerLiter = mapping.pricePerLiter
      ? parseEuNumber(row[mapping.pricePerLiter])
      : NaN;
    if (!Number.isFinite(pricePerLiter) && mapping.totalCost) {
      const total = parseEuNumber(row[mapping.totalCost]);
      if (Number.isFinite(total) && liters > 0) {
        pricePerLiter = Math.round((total / liters) * 1000) / 1000;
      }
    }

    refuels.push({
      vehicleName:
        (mapping.vehicleName ? row[mapping.vehicleName] : defaultVehicle)?.trim()
        ?? '',
      refueledAt: parseEuDate(row[mapping.date]) ?? 'invalid',
      odometerKm: parseEuNumber(row[mapping.odometerKm]),
      liters,
      pricePerLiter,
      isFullTank: parseBool(
        mapping.isFullTank ? row[mapping.isFullTank] : undefined,
        true
      ),
      station: mapping.station ? row[mapping.station]?.trim() || null : null,
      notes: mapping.notes ? row[mapping.notes]?.trim() || null : null,
      sourceRow,
    });
  });

  // le righe non valide non si scartano qui: le boccia validate()
  // con il numero di riga, così l'utente sa cosa correggere
  return { vehicles: [], refuels };
}
