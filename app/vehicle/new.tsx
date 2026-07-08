// ============================================================
// FuelTracker — Nuovo veicolo (app/vehicle/new.tsx)
// Un solo campo obbligatorio (il nome): il resto è opzionale
// e non deve rallentare il primo avvio.
// ============================================================

import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet, Alert,
} from 'react-native';
import { router } from 'expo-router';
import { useDb } from '../../db/DbProvider';
import { insertVehicle } from '../../db/dal';
import { useSession } from '../../auth/useSession';
import type { FuelType } from '../../types';

const FUELS: { value: FuelType; label: string }[] = [
  { value: 'benzina', label: 'Benzina' },
  { value: 'diesel', label: 'Diesel' },
  { value: 'gpl', label: 'GPL' },
  { value: 'metano', label: 'Metano' },
  { value: 'ibrido', label: 'Ibrido' },
  { value: 'elettrico', label: 'Elettrico' },
];

export default function NewVehicleScreen() {
  const db = useDb();
  const { userId } = useSession();

  const [name, setName] = useState('');
  const [fuel, setFuel] = useState<FuelType>('benzina');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [plate, setPlate] = useState('');
  const [saving, setSaving] = useState(false);

  const canSave = name.trim().length > 0 && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await insertVehicle(db, {
        name: name.trim(),
        fuel,
        make: make.trim() || null,
        model: model.trim() || null,
        plate: plate.trim().toUpperCase() || null,
        initial_odometer_km: null,
      }, userId);
      router.back();
    } catch {
      Alert.alert('Errore', 'Veicolo non salvato. Riprova.');
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
      <Text style={s.label}>Nome *</Text>
      <TextInput
        style={s.input}
        value={name}
        onChangeText={setName}
        placeholder="es. Panda di casa"
        autoFocus
      />

      <Text style={s.label}>Carburante</Text>
      <View style={s.chips}>
        {FUELS.map((f) => (
          <Pressable
            key={f.value}
            onPress={() => setFuel(f.value)}
            style={[s.chip, fuel === f.value && s.chipActive]}
          >
            <Text style={[s.chipText, fuel === f.value && s.chipTextActive]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={s.label}>Marca</Text>
      <TextInput style={s.input} value={make} onChangeText={setMake} placeholder="es. Fiat" />

      <Text style={s.label}>Modello</Text>
      <TextInput style={s.input} value={model} onChangeText={setModel} placeholder="es. Panda 1.2" />

      <Text style={s.label}>Targa</Text>
      <TextInput
        style={s.input}
        value={plate}
        onChangeText={setPlate}
        placeholder="es. AB123CD"
        autoCapitalize="characters"
      />

      <Pressable style={[s.saveBtn, !canSave && s.saveBtnDisabled]} disabled={!canSave} onPress={save}>
        <Text style={s.saveBtnText}>{saving ? 'Salvataggio…' : 'Salva veicolo'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const c = {
  bg: '#FFFFFF', text: '#1A1D21', muted: '#6B7280',
  border: '#D1D5DB', accent: '#0F6E5D', accentSoft: '#E6F2EF',
};

const s = StyleSheet.create({
  container: { padding: 20, gap: 8, backgroundColor: c.bg },
  label: { fontSize: 13, fontWeight: '600', color: c.muted, marginTop: 12 },
  input: {
    borderWidth: 1, borderColor: c.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: c.text,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, borderColor: c.border,
  },
  chipActive: { backgroundColor: c.accentSoft, borderColor: c.accent },
  chipText: { fontSize: 15, color: c.text },
  chipTextActive: { color: c.accent, fontWeight: '600' },
  saveBtn: {
    backgroundColor: c.accent, borderRadius: 12,
    paddingVertical: 16, alignItems: 'center', marginTop: 24,
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { color: '#FFF', fontSize: 17, fontWeight: '600' },
});
