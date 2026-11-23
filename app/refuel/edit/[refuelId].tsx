// ============================================================
// FuelTracker — Modifica/cancellazione rifornimento
// Percorso Expo Router: app/refuel/edit/[refuelId].tsx
//
// Stessi campi e stesso stile di refuel/new.tsx; la data è
// mostrata ma non editabile (correzioni di data = casi rari,
// meglio cancellare e reinserire che complicare il form).
// La cancellazione è un soft delete e passa dall'outbox come
// ogni altra scrittura.
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, Pressable, Switch, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useDb } from '../../../db/DbProvider';
import { getRefuel, updateRefuel, deleteRefuel } from '../../../db/dal';
import { confirmAsync } from '../../../lib/confirm';
import type { Refuel } from '../../../types';

const parseNum = (s: string): number | null => {
  const n = Number(s.replace(',', '.').trim());
  return Number.isFinite(n) && s.trim() !== '' ? n : null;
};
const fmtDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

export default function EditRefuelScreen() {
  const { refuelId } = useLocalSearchParams<{ refuelId: string }>();
  const db = useDb();

  const [original, setOriginal] = useState<Refuel | null>(null);
  const [odometer, setOdometer] = useState('');
  const [liters, setLiters] = useState('');
  const [pricePerLiter, setPricePerLiter] = useState('');
  const [isFullTank, setIsFullTank] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!refuelId) return;
    const load = async () => {
      const r = await getRefuel(db, refuelId);
      if (!r) { setError('Rifornimento non trovato.'); return; }
      setOriginal(r);
      setOdometer(String(r.odometer_km).replace('.', ','));
      setLiters(String(r.liters).replace('.', ','));
      setPricePerLiter(String(r.price_per_liter).replace('.', ','));
      setIsFullTank(r.is_full_tank);
    };
    // su web getRefuel va in rete e può fallire: errore visibile, non
    // una promise rifiutata senza gestore
    load().catch(() => setError('Impossibile caricare il rifornimento.'));
  }, [db, refuelId]);

  const odoNum = parseNum(odometer);
  const litersNum = parseNum(liters);
  const priceNum = parseNum(pricePerLiter);

  const total = useMemo(
    () => litersNum !== null && priceNum !== null
      ? Math.round(litersNum * priceNum * 100) / 100
      : null,
    [litersNum, priceNum]
  );

  const canSave =
    original !== null &&
    odoNum !== null && odoNum >= 0 &&
    litersNum !== null && litersNum > 0 &&
    priceNum !== null && priceNum >= 0 &&
    !busy;

  const save = async () => {
    if (!canSave || !original) return;
    setBusy(true);
    setError(null);
    try {
      await updateRefuel(db, original.id, {
        odometer_km: odoNum!,
        liters: litersNum!,
        price_per_liter: priceNum!,
        is_full_tank: isFullTank,
      });
      router.back();
    } catch {
      setError('Modifica non salvata. Riprova.');
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!original || busy) return;
    const ok = await confirmAsync(
      'Cancellare il rifornimento?',
      `${fmtDate(original.refueled_at)} · ${String(original.liters).replace('.', ',')} l · € ${original.total_cost.toFixed(2).replace('.', ',')}`,
      'Cancella',
      true
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await deleteRefuel(db, original.id);
      router.back();
    } catch {
      setError('Cancellazione non riuscita. Riprova.');
      setBusy(false);
    }
  };

  if (error && !original) {
    return (
      <View style={s.center}><Text style={s.errorText}>{error}</Text></View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={s.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">

        {original && (
          <Text style={s.dateLine}>
            Registrato il {fmtDate(original.refueled_at)}
          </Text>
        )}

        <Text style={s.label}>Chilometri totali</Text>
        <TextInput
          style={s.input}
          value={odometer}
          onChangeText={setOdometer}
          keyboardType="decimal-pad"
        />

        <View style={s.row}>
          <View style={s.col}>
            <Text style={s.label}>Litri</Text>
            <TextInput
              style={s.input}
              value={liters}
              onChangeText={setLiters}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={s.col}>
            <Text style={s.label}>€ / litro</Text>
            <TextInput
              style={s.input}
              value={pricePerLiter}
              onChangeText={setPricePerLiter}
              keyboardType="decimal-pad"
            />
          </View>
        </View>

        <View style={s.rowBetween}>
          <View style={s.rowCenter}>
            <Switch value={isFullTank} onValueChange={setIsFullTank} />
            <Text style={s.switchLabel}>Pieno</Text>
          </View>
          <Text style={s.total}>
            {total !== null ? `€ ${total.toFixed(2).replace('.', ',')}` : '€ —'}
          </Text>
        </View>

        {error && <Text style={s.errorText}>{error}</Text>}

        <Pressable
          style={[s.saveBtn, !canSave && s.saveBtnDisabled]}
          disabled={!canSave}
          onPress={save}
        >
          <Text style={s.saveBtnText}>
            {busy ? 'Salvataggio…' : 'Salva modifiche'}
          </Text>
        </Pressable>

        <Pressable style={s.deleteBtn} disabled={busy} onPress={remove}>
          <Text style={s.deleteBtnText}>Cancella rifornimento</Text>
        </Pressable>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const c = {
  bg: '#FFFFFF', text: '#1A1D21', muted: '#6B7280',
  border: '#D1D5DB', accent: '#0F6E5D', danger: '#B91C1C',
};

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: c.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  container: { padding: 20, gap: 8 },
  dateLine: { fontSize: 13, color: c.muted },
  label: { fontSize: 13, fontWeight: '600', color: c.muted, marginTop: 12 },
  input: {
    borderWidth: 1, borderColor: c.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 22, fontVariant: ['tabular-nums'], color: c.text,
  },
  row: { flexDirection: 'row', gap: 12 },
  col: { flex: 1 },
  rowBetween: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginTop: 16,
  },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  switchLabel: { fontSize: 16, color: c.text },
  total: { fontSize: 26, fontWeight: '700', color: c.text, fontVariant: ['tabular-nums'] },
  errorText: { color: c.danger, fontSize: 14, marginTop: 8 },
  saveBtn: {
    backgroundColor: c.accent, borderRadius: 12,
    paddingVertical: 16, alignItems: 'center', marginTop: 24,
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { color: '#FFF', fontSize: 17, fontWeight: '600' },
  deleteBtn: { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  deleteBtnText: { color: c.danger, fontSize: 15, fontWeight: '600' },
});
