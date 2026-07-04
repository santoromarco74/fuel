// ============================================================
// FuelTracker — Schermata "Nuovo rifornimento"
// Percorso Expo Router: app/refuel/new.tsx
//
// Obiettivo di design: registrare un pieno in ~10 secondi.
// Come ci si arriva:
//   - veicolo preselezionato (l'ultimo usato)
//   - data = adesso (modificabile solo se serve)
//   - prezzo/litro precompilato dall'ultimo rifornimento
//   - "Pieno" attivo di default
//   - l'utente digita davvero solo: km e litri
//   - virgola decimale accettata (tastiere italiane)
//   - totale calcolato live, nessun campo ridondante
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, Pressable, Switch, ScrollView,
  StyleSheet, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useDb } from '../../db/DbProvider';
import { listVehicles, listRefuels, insertRefuel } from '../../db/dal';
import type { Vehicle, Refuel } from '../../types';
import { useSession } from '../../auth/useSession'; // -> { userId }

// ---------- parsing numerico "italiano" ----------
const parseNum = (s: string): number | null => {
  const n = Number(s.replace(',', '.').trim());
  return Number.isFinite(n) && s.trim() !== '' ? n : null;
};

export default function NewRefuelScreen() {
  const db = useDb();
  const { userId } = useSession();

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [lastRefuel, setLastRefuel] = useState<Refuel | null>(null);

  const [odometer, setOdometer] = useState('');
  const [liters, setLiters] = useState('');
  const [pricePerLiter, setPricePerLiter] = useState('');
  const [isFullTank, setIsFullTank] = useState(true);
  const [saving, setSaving] = useState(false);

  // Carica veicoli; preseleziona quello dell'ultimo rifornimento
  useEffect(() => {
    (async () => {
      const vs = await listVehicles(db);
      setVehicles(vs);
      if (vs.length === 1) setVehicleId(vs[0].id);
      // TODO: se >1, recuperare l'ultimo usato da una preferenza locale
      else if (vs.length > 1) setVehicleId(vs[0].id);
    })();
  }, [db]);

  // Al cambio veicolo: ultimo rifornimento -> prefill prezzo + km di riferimento
  useEffect(() => {
    if (!vehicleId) { setLastRefuel(null); return; }
    (async () => {
      const rs = await listRefuels(db, vehicleId); // già DESC per odometro
      const last = rs[0] ?? null;
      setLastRefuel(last);
      if (last && pricePerLiter === '') {
        setPricePerLiter(String(last.price_per_liter).replace('.', ','));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId, db]);

  const odoNum = parseNum(odometer);
  const litersNum = parseNum(liters);
  const priceNum = parseNum(pricePerLiter);

  const total = useMemo(
    () => litersNum !== null && priceNum !== null
      ? Math.round(litersNum * priceNum * 100) / 100
      : null,
    [litersNum, priceNum]
  );

  const odoWarning =
    odoNum !== null && lastRefuel && odoNum <= lastRefuel.odometer_km
      ? `Ultimo rifornimento: ${lastRefuel.odometer_km} km`
      : null;

  const canSave =
    vehicleId !== null &&
    odoNum !== null && odoNum >= 0 &&
    litersNum !== null && litersNum > 0 &&
    priceNum !== null && priceNum >= 0 &&
    !saving;

  const save = async () => {
    if (!canSave || !vehicleId) return;
    // km non crescenti: chiedi conferma ma non bloccare
    // (correzioni retroattive e cambi contachilometri esistono)
    if (odoWarning) {
      const ok = await new Promise<boolean>((res) =>
        Alert.alert(
          'Chilometri non crescenti',
          `${odoWarning}. Salvare comunque?`,
          [
            { text: 'Annulla', style: 'cancel', onPress: () => res(false) },
            { text: 'Salva', onPress: () => res(true) },
          ]
        )
      );
      if (!ok) return;
    }
    setSaving(true);
    try {
      await insertRefuel(db, {
        vehicle_id: vehicleId,
        refueled_at: new Date().toISOString(),
        odometer_km: odoNum!,
        liters: litersNum!,
        price_per_liter: priceNum!,
        is_full_tank: isFullTank,
        station: null,
        notes: null,
      }, userId);
      router.back();
    } catch (e) {
      Alert.alert('Errore', 'Rifornimento non salvato. Riprova.');
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={s.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">

        {/* Veicolo: chip orizzontali, un tap */}
        <Text style={s.label}>Veicolo</Text>
        <View style={s.chips}>
          {vehicles.map((v) => (
            <Pressable
              key={v.id}
              onPress={() => setVehicleId(v.id)}
              style={[s.chip, vehicleId === v.id && s.chipActive]}
            >
              <Text style={[s.chipText, vehicleId === v.id && s.chipTextActive]}>
                {v.name}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Chilometri: il primo campo, autofocus */}
        <Text style={s.label}>Chilometri totali</Text>
        <TextInput
          style={[s.input, odoWarning ? s.inputWarning : null]}
          value={odometer}
          onChangeText={setOdometer}
          keyboardType="decimal-pad"
          autoFocus
          placeholder={lastRefuel ? `> ${lastRefuel.odometer_km}` : 'es. 87450'}
          returnKeyType="next"
        />
        {odoWarning && <Text style={s.warning}>{odoWarning}</Text>}

        <View style={s.row}>
          <View style={s.col}>
            <Text style={s.label}>Litri</Text>
            <TextInput
              style={s.input}
              value={liters}
              onChangeText={setLiters}
              keyboardType="decimal-pad"
              placeholder="es. 38,5"
            />
          </View>
          <View style={s.col}>
            <Text style={s.label}>€ / litro</Text>
            <TextInput
              style={s.input}
              value={pricePerLiter}
              onChangeText={setPricePerLiter}
              keyboardType="decimal-pad"
              placeholder="es. 1,789"
            />
          </View>
        </View>

        {/* Pieno + totale sulla stessa riga: densità senza rumore */}
        <View style={s.rowBetween}>
          <View style={s.rowCenter}>
            <Switch value={isFullTank} onValueChange={setIsFullTank} />
            <Text style={s.switchLabel}>Pieno</Text>
          </View>
          <Text style={s.total}>
            {total !== null ? `€ ${total.toFixed(2).replace('.', ',')}` : '€ —'}
          </Text>
        </View>

        {!isFullTank && (
          <Text style={s.hint}>
            Rabbocco: il consumo verrà calcolato al prossimo pieno.
          </Text>
        )}

        <Pressable
          style={[s.saveBtn, !canSave && s.saveBtnDisabled]}
          disabled={!canSave}
          onPress={save}
        >
          <Text style={s.saveBtnText}>
            {saving ? 'Salvataggio…' : 'Salva rifornimento'}
          </Text>
        </Pressable>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ---------- stile: sobrio, alta leggibilità all'aperto ----------
const c = {
  bg: '#FFFFFF',
  text: '#1A1D21',
  muted: '#6B7280',
  border: '#D1D5DB',
  accent: '#0F6E5D',      // verde profondo, leggibile in pieno sole
  accentSoft: '#E6F2EF',
  warning: '#B45309',
};

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: c.bg },
  container: { padding: 20, gap: 8 },
  label: { fontSize: 13, fontWeight: '600', color: c.muted, marginTop: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, borderColor: c.border,
  },
  chipActive: { backgroundColor: c.accentSoft, borderColor: c.accent },
  chipText: { fontSize: 15, color: c.text },
  chipTextActive: { color: c.accent, fontWeight: '600' },
  input: {
    borderWidth: 1, borderColor: c.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 22, fontVariant: ['tabular-nums'], color: c.text,
  },
  inputWarning: { borderColor: c.warning },
  warning: { color: c.warning, fontSize: 13 },
  row: { flexDirection: 'row', gap: 12 },
  col: { flex: 1 },
  rowBetween: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginTop: 16,
  },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  switchLabel: { fontSize: 16, color: c.text },
  total: { fontSize: 26, fontWeight: '700', color: c.text, fontVariant: ['tabular-nums'] },
  hint: { fontSize: 13, color: c.muted },
  saveBtn: {
    backgroundColor: c.accent, borderRadius: 12,
    paddingVertical: 16, alignItems: 'center', marginTop: 24,
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { color: '#FFF', fontSize: 17, fontWeight: '600' },
});
