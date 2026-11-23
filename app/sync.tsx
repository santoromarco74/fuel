// ============================================================
// FuelTracker — Stato sincronizzazione (app/sync.tsx)
//
// Espone quello che l'engine non risolve da solo: gli item
// dell'outbox che hanno esaurito i tentativi (listStuckItems).
// L'utente può riprovare il sync o scartare un item bloccato —
// scelta esplicita, mai silenziosa (invariante n. 6).
// Sul web engine e coda sono no-op: la schermata mostra solo
// "tutto sincronizzato".
// ============================================================

import { useCallback, useState } from 'react';
import {
  View, Text, Pressable, FlatList, StyleSheet, RefreshControl,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useDb } from '../db/DbProvider';
import { pendingCount } from '../db/dal';
import {
  syncNow, listStuckItems, discardStuckItem, type SyncResult,
} from '../sync/engine';
import { supabase } from '../lib/supabase';
import { confirmAsync } from '../lib/confirm';

type StuckItem = Awaited<ReturnType<typeof listStuckItems>>[number];

const TABLE_LABEL: Record<string, string> = {
  vehicles: 'Veicolo', refuels: 'Rifornimento',
};
const OP_LABEL: Record<string, string> = {
  insert: 'creazione', update: 'modifica', delete: 'cancellazione',
};
const fmtDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

export default function SyncScreen() {
  const db = useDb();
  const [pending, setPending] = useState(0);
  const [stuck, setStuck] = useState<StuckItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);

  const load = useCallback(async () => {
    setPending(await pendingCount(db));
    setStuck(await listStuckItems(db as never));
  }, [db]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const retry = async () => {
    setBusy(true);
    const r = await syncNow(db as never, supabase);
    setLastResult(r);
    await load();
    setBusy(false);
  };

  const discard = async (item: StuckItem) => {
    const ok = await confirmAsync(
      'Scartare questa operazione?',
      `${TABLE_LABEL[item.table_name]} — ${OP_LABEL[item.operation]} del ${fmtDate(item.created_at ?? '')}.\n` +
      'Il dato locale resta, ma questa modifica non verrà mai inviata al server.',
      'Scarta',
      true
    );
    if (!ok) return;
    await discardStuckItem(db as never, item.id);
    await load();
  };

  const healthy = stuck.length === 0;

  return (
    <FlatList
      style={s.flex}
      data={stuck}
      keyExtractor={(i) => String(i.id)}
      contentContainerStyle={s.list}
      refreshControl={<RefreshControl refreshing={busy} onRefresh={retry} />}
      ListHeaderComponent={
        <View style={s.header}>
          <Text style={s.stateLine}>
            {pending === 0
              ? 'Tutto sincronizzato.'
              : `${pending} ${pending === 1 ? 'operazione' : 'operazioni'} in coda.`}
          </Text>
          {lastResult && !lastResult.ok && (
            <Text style={s.errorLine}>Ultimo tentativo: {lastResult.error}</Text>
          )}
          {!healthy && (
            <Text style={s.stuckIntro}>
              Queste operazioni hanno esaurito i tentativi e bloccano la coda.
              Puoi riprovare (trascina in basso) o scartarle singolarmente.
            </Text>
          )}
          <Pressable style={s.retryBtn} disabled={busy} onPress={retry}>
            <Text style={s.retryBtnText}>
              {busy ? 'Sincronizzazione…' : 'Sincronizza adesso'}
            </Text>
          </Pressable>
        </View>
      }
      renderItem={({ item }) => (
        <View style={s.card}>
          <Text style={s.cardTitle}>
            {TABLE_LABEL[item.table_name] ?? item.table_name} · {OP_LABEL[item.operation] ?? item.operation}
          </Text>
          <Text style={s.cardMeta}>
            del {fmtDate(item.created_at ?? '')} · {item.attempts} tentativi
          </Text>
          {item.last_error && (
            <Text style={s.cardError} numberOfLines={3}>{item.last_error}</Text>
          )}
          <Pressable style={s.discardBtn} onPress={() => discard(item)}>
            <Text style={s.discardBtnText}>Scarta operazione</Text>
          </Pressable>
        </View>
      )}
    />
  );
}

const c = {
  bg: '#FFFFFF', text: '#1A1D21', muted: '#6B7280',
  border: '#D1D5DB', accent: '#0F6E5D', cardBg: '#F4F6F5',
  danger: '#B91C1C', warning: '#B45309',
};

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: c.bg },
  list: { padding: 20, gap: 10 },
  header: { gap: 8, marginBottom: 8 },
  stateLine: { fontSize: 16, fontWeight: '600', color: c.text },
  errorLine: { fontSize: 13, color: c.warning },
  stuckIntro: { fontSize: 13, color: c.muted },
  retryBtn: {
    backgroundColor: c.accent, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center', marginTop: 8,
  },
  retryBtnText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  card: { backgroundColor: c.cardBg, borderRadius: 12, padding: 14, gap: 4 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: c.text },
  cardMeta: { fontSize: 12, color: c.muted },
  cardError: { fontSize: 12, color: c.danger },
  discardBtn: { alignSelf: 'flex-start', paddingVertical: 6 },
  discardBtnText: { color: c.danger, fontSize: 13, fontWeight: '600' },
});
