// ============================================================
// FuelTracker — Storico rifornimenti di un veicolo
// Percorso Expo Router: app/refuel/[vehicleId].tsx
// (la rotta statica /refuel/new ha la precedenza sulla dinamica)
//
// Elenco completo ordinato per odometro decrescente (lo stesso
// ordine del DAL): il più recente in alto. Tap su una riga ->
// modifica/cancellazione. FAB per un nuovo rifornimento.
// ============================================================

import { useCallback, useState } from 'react';
import {
  View, Text, Pressable, FlatList, StyleSheet,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useDb } from '../../db/DbProvider';
import { getVehicle, listRefuels } from '../../db/dal';
import type { Refuel, Vehicle } from '../../types';

// "2026-07-04T…" -> "04/07/2026" senza dipendere da Intl
const fmtDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};
const fmtNum = (n: number) => String(n).replace('.', ',');

export default function RefuelHistoryScreen() {
  const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();
  const db = useDb();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [refuels, setRefuels] = useState<Refuel[]>([]);

  const load = useCallback(async () => {
    if (!vehicleId) return;
    setVehicle(await getVehicle(db, vehicleId));
    setRefuels(await listRefuels(db, vehicleId));
  }, [db, vehicleId]);

  // ricarica al ritorno dalla schermata di modifica
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={s.flex}>
      <FlatList
        data={refuels}
        keyExtractor={(r) => r.id}
        contentContainerStyle={s.list}
        ListHeaderComponent={
          vehicle ? <Text style={s.vehicleName}>{vehicle.name}</Text> : null
        }
        ListEmptyComponent={
          <View style={s.emptyBox}>
            <Text style={s.emptyTitle}>Nessun rifornimento</Text>
            <Text style={s.emptyText}>
              I rifornimenti registrati per questo veicolo compariranno qui.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            style={s.row}
            onPress={() => router.push(`/refuel/edit/${item.id}`)}
          >
            <View style={s.rowLeft}>
              <Text style={s.rowDate}>{fmtDate(item.refueled_at)}</Text>
              <Text style={s.rowMeta}>
                {fmtNum(item.odometer_km)} km · {fmtNum(item.liters)} l
                {' · '}{fmtNum(item.price_per_liter)} €/l
              </Text>
            </View>
            <View style={s.rowRight}>
              <Text style={s.rowTotal}>
                € {item.total_cost.toFixed(2).replace('.', ',')}
              </Text>
              <Text style={[s.badge, item.is_full_tank ? s.badgeFull : s.badgeTopUp]}>
                {item.is_full_tank ? 'Pieno' : 'Rabbocco'}
              </Text>
            </View>
          </Pressable>
        )}
      />

      <Pressable style={s.fab} onPress={() => router.push('/refuel/new')}>
        <Text style={s.fabText}>Nuovo rifornimento</Text>
      </Pressable>
    </View>
  );
}

const c = {
  bg: '#FFFFFF', text: '#1A1D21', muted: '#6B7280',
  border: '#D1D5DB', accent: '#0F6E5D', cardBg: '#F4F6F5',
  warning: '#B45309',
};

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: c.bg },
  list: { padding: 20, gap: 8, paddingBottom: 120 },
  vehicleName: { fontSize: 13, fontWeight: '600', color: c.muted, marginBottom: 4 },
  emptyBox: { alignItems: 'center', paddingVertical: 48, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: c.text },
  emptyText: { fontSize: 14, color: c.muted, textAlign: 'center', paddingHorizontal: 24 },
  row: {
    backgroundColor: c.cardBg, borderRadius: 12, padding: 14,
    flexDirection: 'row', alignItems: 'center',
  },
  rowLeft: { flex: 1, gap: 2 },
  rowDate: { fontSize: 15, fontWeight: '600', color: c.text },
  rowMeta: { fontSize: 13, color: c.muted, fontVariant: ['tabular-nums'] },
  rowRight: { alignItems: 'flex-end', gap: 4 },
  rowTotal: { fontSize: 16, fontWeight: '700', color: c.text, fontVariant: ['tabular-nums'] },
  badge: {
    fontSize: 11, fontWeight: '600', paddingHorizontal: 8,
    paddingVertical: 2, borderRadius: 8, overflow: 'hidden',
  },
  badgeFull: { backgroundColor: '#E6F2EF', color: c.accent },
  badgeTopUp: { backgroundColor: '#FEF3E2', color: c.warning },
  fab: {
    position: 'absolute', bottom: 24, left: 20, right: 20,
    backgroundColor: c.accent, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', elevation: 4,
  },
  fabText: { color: '#FFF', fontSize: 17, fontWeight: '600' },
});
