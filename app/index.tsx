// ============================================================
// FuelTracker — Home / lista veicoli (app/index.tsx)
//
// Job della schermata: arrivare al rifornimento in un tap.
// Il pulsante primario è "Nuovo rifornimento"; la card del
// veicolo porta alle statistiche. Lo stato del sync è visibile
// ma discreto (contatore operazioni in attesa).
// ============================================================

import { useCallback, useState } from 'react';
import {
  View, Text, Pressable, FlatList, StyleSheet, RefreshControl,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useDb } from '../db/DbProvider';
import { listVehicles, pendingCount } from '../db/dal';
import { syncNow } from '../sync/engine';
import { supabase } from '../lib/supabase';
import { signOut } from '../auth/useSession';
import type { Vehicle } from '../types';

const FUEL_LABEL: Record<string, string> = {
  benzina: 'Benzina', diesel: 'Diesel', gpl: 'GPL',
  metano: 'Metano', elettrico: 'Elettrico', ibrido: 'Ibrido',
};

export default function HomeScreen() {
  const db = useDb();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [pending, setPending] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setVehicles(await listVehicles(db));
    setPending(await pendingCount(db));
  }, [db]);

  // ricarica a ogni ritorno sulla schermata (dopo un inserimento)
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await syncNow(db as never, supabase); // su web: no-op
    await load();
    setRefreshing(false);
  };

  return (
    <View style={s.flex}>
      <FlatList
        data={vehicles}
        keyExtractor={(v) => v.id}
        contentContainerStyle={s.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListHeaderComponent={
          pending > 0 ? (
            <Pressable onPress={() => router.push('/sync')}>
              <Text style={s.pending}>
                {pending} {pending === 1 ? 'operazione' : 'operazioni'} in attesa di sincronizzazione ›
              </Text>
            </Pressable>
          ) : null
        }
        ListEmptyComponent={
          <View style={s.emptyBox}>
            <Text style={s.emptyTitle}>Nessun veicolo</Text>
            <Text style={s.emptyText}>
              Aggiungi il tuo primo veicolo per iniziare a registrare i rifornimenti.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            style={s.card}
            onPress={() => router.push(`/stats/${item.id}`)}
          >
            <View style={s.cardBody}>
              <Text style={s.cardName}>{item.name}</Text>
              <Text style={s.cardMeta}>
                {[item.make, item.model].filter(Boolean).join(' ') || FUEL_LABEL[item.fuel]}
                {item.plate ? ` · ${item.plate}` : ''}
              </Text>
            </View>
            <Text style={s.cardChevron}>›</Text>
          </Pressable>
        )}
        ListFooterComponent={
          <View>
            <Pressable style={s.addVehicle} onPress={() => router.push('/vehicle/new')}>
              <Text style={s.addVehicleText}>+ Aggiungi veicolo</Text>
            </Pressable>
            <Pressable style={s.footerLink} onPress={() => router.push('/import')}>
              <Text style={s.footerLinkText}>Importa dati</Text>
            </Pressable>
            <Pressable style={s.footerLink} onPress={() => router.push('/backup')}>
              <Text style={s.footerLinkText}>Backup Google Drive</Text>
            </Pressable>
          </View>
        }
      />

      {vehicles.length > 0 && (
        <Pressable style={s.fab} onPress={() => router.push('/refuel/new')}>
          <Text style={s.fabText}>Nuovo rifornimento</Text>
        </Pressable>
      )}

      <Pressable style={s.logout} onPress={signOut}>
        <Text style={s.logoutText}>Esci</Text>
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
  list: { padding: 20, gap: 10, paddingBottom: 120 },
  pending: { color: c.warning, fontSize: 13, marginBottom: 4 },
  emptyBox: { alignItems: 'center', paddingVertical: 48, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: c.text },
  emptyText: { fontSize: 14, color: c.muted, textAlign: 'center', paddingHorizontal: 24 },
  card: {
    backgroundColor: c.cardBg, borderRadius: 14,
    padding: 16, flexDirection: 'row', alignItems: 'center',
  },
  cardBody: { flex: 1, gap: 2 },
  cardName: { fontSize: 17, fontWeight: '600', color: c.text },
  cardMeta: { fontSize: 13, color: c.muted },
  cardChevron: { fontSize: 26, color: c.muted },
  addVehicle: { paddingVertical: 14, alignItems: 'center' },
  addVehicleText: { color: c.accent, fontSize: 15, fontWeight: '600' },
  footerLink: { paddingVertical: 10, alignItems: 'center' },
  footerLinkText: { color: c.muted, fontSize: 14, fontWeight: '600' },
  fab: {
    position: 'absolute', bottom: 24, left: 20, right: 20,
    backgroundColor: c.accent, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
    elevation: 4,
  },
  fabText: { color: '#FFF', fontSize: 17, fontWeight: '600' },
  logout: { position: 'absolute', top: 8, right: 16 },
  logoutText: { color: c.muted, fontSize: 13 },
});
