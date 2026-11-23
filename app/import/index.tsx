// ============================================================
// FuelTracker — Import dati (app/import/index.tsx)
//
// Flusso in quattro fasi:
//   pick    -> scelta file (CSV qualsiasi o backup JSON)
//   map     -> solo CSV: associazione colonne -> campi, con
//              pre-compilazione euristica dai nomi delle colonne
//   preview -> anteprima validate(): validi/duplicati/errori,
//              veicoli nuovi e riconosciuti. Nulla è scritto.
//   done    -> esito del commit
//
// La scrittura passa dal writer sopra il DAL: su Android va
// nell'outbox (import possibile offline), sul web su Supabase.
// ============================================================

import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet,
} from 'react-native';
import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { useDb } from '../../db/DbProvider';
import { useSession } from '../../auth/useSession';
import { readTextFile } from '../../lib/readFile';
import {
  validate, commit,
  type IntermediateImport, type ImportPreview, type ImportResult,
} from '../../import/pipeline';
import {
  readCsvHeaders, parseGenericCsv, type ColumnMapping,
} from '../../import/genericCsv';
import { parseBackupJson } from '../../import/backup';
import { makeImportWriter } from '../../import/writer';

type FieldKey =
  | 'date' | 'odometerKm' | 'liters' | 'pricePerLiter' | 'totalCost'
  | 'vehicleName' | 'isFullTank' | 'station' | 'notes';

const FIELDS: { key: FieldKey; label: string; required?: boolean }[] = [
  { key: 'date', label: 'Data', required: true },
  { key: 'odometerKm', label: 'Chilometri', required: true },
  { key: 'liters', label: 'Litri', required: true },
  { key: 'pricePerLiter', label: 'Prezzo al litro' },
  { key: 'totalCost', label: 'Costo totale' },
  { key: 'vehicleName', label: 'Veicolo' },
  { key: 'isFullTank', label: 'Pieno (sì/no)' },
  { key: 'station', label: 'Distributore' },
  { key: 'notes', label: 'Note' },
];

// euristica di pre-compilazione: nome colonna -> campo
const GUESSES: Record<FieldKey, string[]> = {
  date: ['data', 'date', 'giorno'],
  odometerKm: ['odometro', 'chilometr', 'contachilometri', 'km'],
  liters: ['litri', 'liter', 'quantit'],
  pricePerLiter: ['prezzo', 'price', '/l'],
  totalCost: ['costo', 'totale', 'importo', 'spesa', 'total'],
  vehicleName: ['veicolo', 'vehicle', 'auto', 'mezzo'],
  isFullTank: ['pieno', 'full'],
  station: ['distributore', 'stazione', 'station'],
  notes: ['note', 'commento', 'comment'],
};

function guessMapping(headers: string[]): Partial<Record<FieldKey, string>> {
  const m: Partial<Record<FieldKey, string>> = {};
  const taken = new Set<string>();
  for (const f of FIELDS) {
    const hit = headers.find(
      (h) => !taken.has(h) &&
        GUESSES[f.key].some((g) => h.toLowerCase().includes(g))
    );
    if (hit) { m[f.key] = hit; taken.add(hit); }
  }
  return m;
}

type Phase = 'pick' | 'map' | 'preview' | 'done';

export default function ImportScreen() {
  const db = useDb();
  const { userId } = useSession();

  const [phase, setPhase] = useState<Phase>('pick');
  const [fileName, setFileName] = useState('');
  const [csvText, setCsvText] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Partial<Record<FieldKey, string>>>({});
  const [defaultVehicle, setDefaultVehicle] = useState('');
  const [intermediate, setIntermediate] = useState<IntermediateImport | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const writer = () => makeImportWriter(db, userId);

  const runValidate = async (data: IntermediateImport) => {
    setBusy(true);
    setError(null);
    try {
      setIntermediate(data);
      setPreview(await validate(data, writer()));
      setPhase('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // ---------- fase 1: scelta file ----------

  const pickFile = async () => {
    setError(null);
    const res = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      type: [
        'text/csv', 'text/comma-separated-values', 'text/plain',
        'application/json', 'application/vnd.ms-excel',
      ],
    });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    setFileName(asset.name ?? 'file');

    setBusy(true);
    try {
      const text = await readTextFile(asset.uri);
      const isJson =
        asset.name?.toLowerCase().endsWith('.json') || text.trim().startsWith('{');
      if (isJson) {
        // backup FuelTracker: niente mappatura, dritto in anteprima
        await runValidate(parseBackupJson(text));
      } else {
        const hs = readCsvHeaders(text);
        if (hs.length < 2) {
          setError('Il file non sembra un CSV con intestazioni.');
          return;
        }
        setCsvText(text);
        setHeaders(hs);
        setMapping(guessMapping(hs));
        setPhase('map');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // ---------- fase 2: mappatura colonne ----------

  const toggle = (key: FieldKey, header: string) =>
    setMapping((m) => ({ ...m, [key]: m[key] === header ? undefined : header }));

  const mappingReady =
    !!mapping.date && !!mapping.odometerKm && !!mapping.liters &&
    (!!mapping.pricePerLiter || !!mapping.totalCost) &&
    (!!mapping.vehicleName || defaultVehicle.trim() !== '');

  const confirmMapping = async () => {
    if (!mappingReady) return;
    const m: ColumnMapping = {
      date: mapping.date!,
      odometerKm: mapping.odometerKm!,
      liters: mapping.liters!,
      pricePerLiter: mapping.pricePerLiter,
      totalCost: mapping.totalCost,
      vehicleName: mapping.vehicleName,
      isFullTank: mapping.isFullTank,
      station: mapping.station,
      notes: mapping.notes,
    };
    await runValidate(parseGenericCsv(csvText, {
      mapping: m,
      defaultVehicle: mapping.vehicleName ? undefined : defaultVehicle.trim(),
    }));
  };

  // ---------- fase 3 -> 4: commit ----------

  const doImport = async () => {
    if (!preview || !intermediate || preview.valid.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await commit(preview, intermediate.vehicles, writer()));
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setPhase('pick');
    setFileName(''); setCsvText(''); setHeaders([]);
    setMapping({}); setDefaultVehicle('');
    setIntermediate(null); setPreview(null); setResult(null);
    setError(null);
  };

  // ---------- render ----------

  return (
    <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">

      {phase === 'pick' && (
        <>
          <Text style={s.intro}>
            Importa rifornimenti da un CSV qualsiasi (export di un foglio di
            calcolo o di un'altra app) oppure ripristina un backup FuelTracker.
          </Text>
          <Pressable style={s.primaryBtn} disabled={busy} onPress={pickFile}>
            <Text style={s.primaryBtnText}>
              {busy ? 'Lettura…' : 'Scegli file (CSV o backup JSON)'}
            </Text>
          </Pressable>
          <Text style={s.hint}>
            Formati italiani supportati: virgola decimale (1.234,56) e date
            gg/mm/aaaa. Nessun dato viene scritto prima dell'anteprima.
          </Text>
          {error && <Text style={s.errorText}>{error}</Text>}
        </>
      )}

      {phase === 'map' && (
        <>
          <Text style={s.fileLine}>{fileName}</Text>
          <Text style={s.intro}>
            Associa le colonne del file ai campi. Servono data, chilometri,
            litri e almeno uno tra prezzo al litro e costo totale.
          </Text>

          {FIELDS.map((f) => {
            // il gruppo prezzo/costo è alternativo: lo segnalo nel label
            const req = f.required
              || (f.key === 'pricePerLiter' && !mapping.totalCost)
              || (f.key === 'totalCost' && !mapping.pricePerLiter);
            return (
              <View key={f.key}>
                <Text style={s.label}>
                  {f.label}{req ? ' *' : ''}
                </Text>
                <View style={s.chips}>
                  {headers.map((h) => (
                    <Pressable
                      key={h}
                      onPress={() => toggle(f.key, h)}
                      style={[s.chip, mapping[f.key] === h && s.chipActive]}
                    >
                      <Text style={[s.chipText, mapping[f.key] === h && s.chipTextActive]}>
                        {h}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            );
          })}

          {!mapping.vehicleName && (
            <>
              <Text style={s.label}>Veicolo per tutte le righe *</Text>
              <TextInput
                style={s.input}
                value={defaultVehicle}
                onChangeText={setDefaultVehicle}
                placeholder="es. Panda"
              />
            </>
          )}

          {error && <Text style={s.errorText}>{error}</Text>}

          <Pressable
            style={[s.primaryBtn, !mappingReady && s.btnDisabled]}
            disabled={!mappingReady || busy}
            onPress={confirmMapping}
          >
            <Text style={s.primaryBtnText}>
              {busy ? 'Analisi…' : 'Continua'}
            </Text>
          </Pressable>
          <Pressable style={s.secondaryBtn} onPress={reset}>
            <Text style={s.secondaryBtnText}>Annulla</Text>
          </Pressable>
        </>
      )}

      {phase === 'preview' && preview && (
        <>
          <Text style={s.fileLine}>{fileName}</Text>

          <View style={s.summaryCard}>
            <SummaryRow label="Da importare" value={preview.valid.length} strong />
            <SummaryRow label="Duplicati (saltati)" value={preview.duplicates.length} />
            <SummaryRow label="Righe scartate" value={preview.errors.length} />
          </View>

          {preview.newVehicles.length > 0 && (
            <Text style={s.detailLine}>
              Nuovi veicoli da creare: {preview.newVehicles.join(', ')}
            </Text>
          )}
          {preview.existingVehicles.length > 0 && (
            <Text style={s.detailLine}>
              Veicoli riconosciuti: {preview.existingVehicles.join(', ')}
            </Text>
          )}

          {preview.errors.length > 0 && (
            <View style={s.errorsBox}>
              <Text style={s.errorsTitle}>Righe scartate</Text>
              {preview.errors.slice(0, 20).map((e) => (
                <Text key={e.row} style={s.errorsRow}>
                  riga {e.row}: {e.message}
                </Text>
              ))}
              {preview.errors.length > 20 && (
                <Text style={s.errorsRow}>
                  … e altre {preview.errors.length - 20}
                </Text>
              )}
            </View>
          )}

          {error && <Text style={s.errorText}>{error}</Text>}

          <Pressable
            style={[s.primaryBtn, (preview.valid.length === 0 || busy) && s.btnDisabled]}
            disabled={preview.valid.length === 0 || busy}
            onPress={doImport}
          >
            <Text style={s.primaryBtnText}>
              {busy
                ? 'Importazione…'
                : `Importa ${preview.valid.length} rifornimenti`}
            </Text>
          </Pressable>
          <Pressable style={s.secondaryBtn} onPress={reset}>
            <Text style={s.secondaryBtnText}>Annulla</Text>
          </Pressable>
        </>
      )}

      {phase === 'done' && result && (
        <>
          <Text style={s.doneTitle}>Import completato</Text>
          <View style={s.summaryCard}>
            <SummaryRow label="Rifornimenti importati" value={result.refuelsImported} strong />
            <SummaryRow label="Veicoli creati" value={result.vehiclesCreated} />
          </View>
          <Pressable style={s.primaryBtn} onPress={() => router.back()}>
            <Text style={s.primaryBtnText}>Fine</Text>
          </Pressable>
          <Pressable style={s.secondaryBtn} onPress={reset}>
            <Text style={s.secondaryBtnText}>Importa un altro file</Text>
          </Pressable>
        </>
      )}

    </ScrollView>
  );
}

function SummaryRow({ label, value, strong }: {
  label: string; value: number; strong?: boolean;
}) {
  return (
    <View style={s.summaryRow}>
      <Text style={[s.summaryLabel, strong && s.summaryStrong]}>{label}</Text>
      <Text style={[s.summaryValue, strong && s.summaryStrong]}>{value}</Text>
    </View>
  );
}

const c = {
  bg: '#FFFFFF', text: '#1A1D21', muted: '#6B7280',
  border: '#D1D5DB', accent: '#0F6E5D', accentSoft: '#E6F2EF',
  cardBg: '#F4F6F5', danger: '#B91C1C',
};

const s = StyleSheet.create({
  container: { padding: 20, gap: 8, backgroundColor: c.bg },
  intro: { fontSize: 14, color: c.text, lineHeight: 20 },
  hint: { fontSize: 13, color: c.muted, lineHeight: 18 },
  fileLine: { fontSize: 13, fontWeight: '600', color: c.muted },
  label: { fontSize: 13, fontWeight: '600', color: c.muted, marginTop: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18,
    borderWidth: 1, borderColor: c.border,
  },
  chipActive: { backgroundColor: c.accentSoft, borderColor: c.accent },
  chipText: { fontSize: 14, color: c.text },
  chipTextActive: { color: c.accent, fontWeight: '600' },
  input: {
    borderWidth: 1, borderColor: c.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 16, color: c.text,
  },
  summaryCard: {
    backgroundColor: c.cardBg, borderRadius: 12, padding: 14, gap: 8,
    marginTop: 8,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryLabel: { fontSize: 14, color: c.muted },
  summaryValue: { fontSize: 14, color: c.text, fontVariant: ['tabular-nums'] },
  summaryStrong: { fontWeight: '700', color: c.text, fontSize: 16 },
  detailLine: { fontSize: 13, color: c.text },
  errorsBox: {
    borderWidth: 1, borderColor: c.border, borderRadius: 10,
    padding: 12, gap: 3, marginTop: 4,
  },
  errorsTitle: { fontSize: 13, fontWeight: '600', color: c.text },
  errorsRow: { fontSize: 12, color: c.muted },
  errorText: { color: c.danger, fontSize: 14, marginTop: 8 },
  doneTitle: { fontSize: 20, fontWeight: '700', color: c.text },
  primaryBtn: {
    backgroundColor: c.accent, borderRadius: 12,
    paddingVertical: 15, alignItems: 'center', marginTop: 16,
  },
  btnDisabled: { opacity: 0.4 },
  primaryBtnText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  secondaryBtn: { paddingVertical: 12, alignItems: 'center' },
  secondaryBtnText: { color: c.muted, fontSize: 14, fontWeight: '600' },
});
