// ============================================================
// FuelTracker — Impostazioni backup Google Drive (app/backup.tsx)
//
// Collegamento account (OAuth PKCE), stato ultimo backup, backup
// manuale, elenco backup su Drive e ripristino. Il ripristino
// passa dalla pipeline di import (dedup inclusa): rilanciarlo su
// un DB non vuoto non duplica nulla.
// Sul web i moduli drive/*.web.ts sono no-op e DRIVE_SUPPORTED
// è false: la schermata spiega che è una funzione solo Android.
// ============================================================

import { useCallback, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useDb } from '../db/DbProvider';
import { useSession } from '../auth/useSession';
import { listVehicles, listRefuels } from '../db/dal';
import {
  connectDrive, disconnectDrive, isDriveConnected,
} from '../drive/auth';
import {
  DRIVE_SUPPORTED, BACKUP_INTERVAL_DAYS,
  backupNow, getLastBackupAt, listBackups, downloadBackup,
} from '../drive/backup';
import { parseBackupJson } from '../import/backup';
import { validate, commit } from '../import/pipeline';
import { makeImportWriter } from '../import/writer';
import { confirmAsync } from '../lib/confirm';

function describeFailure(reason: string, detail?: string): string {
  if (reason === 'not_connected') return 'Google Drive non collegato.';
  const extra = detail ? `: ${detail}` : '';
  return `Backup non riuscito (${reason}${extra}).`;
}

const fmtDateTime = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y} ${iso.slice(11, 16)}`;
};

export default function BackupScreen() {
  const db = useDb();
  const { userId } = useSession();

  const [connected, setConnected] = useState(false);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [backups, setBackups] = useState<
    { id: string; name: string; createdTime: string }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    const conn = await isDriveConnected();
    setConnected(conn);
    setLastBackup(await getLastBackupAt());
    if (conn) {
      try { setBackups(await listBackups()); } catch { setBackups([]); }
    } else {
      setBackups([]);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    if (!DRIVE_SUPPORTED) return;
    load().catch(() => setStatus('Impossibile leggere lo stato del backup.'));
  }, [load]));

  const connect = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const ok = await connectDrive();
      setStatus(ok ? 'Google Drive collegato.' : 'Collegamento annullato.');
      await load();
    } catch {
      setStatus('Collegamento non riuscito. Riprova.');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    const ok = await confirmAsync(
      'Scollegare Google Drive?',
      'I backup già presenti su Drive restano; semplicemente non ne verranno creati di nuovi.',
      'Scollega'
    );
    if (!ok) return;
    await disconnectDrive();
    setStatus('Google Drive scollegato.');
    await load();
  };

  const runBackup = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const vehicles = await listVehicles(db);
      const refuels = (
        await Promise.all(vehicles.map((v) => listRefuels(db, v.id)))
      ).flat();
      const outcome = await backupNow(vehicles, refuels);
      if (outcome.ok) {
        setStatus(`Backup completato: ${outcome.fileName}`);
      } else {
        setStatus(describeFailure(outcome.reason, outcome.detail));
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const restore = async (fileId: string, fileName: string) => {
    setBusy(true);
    setStatus(null);
    try {
      const data = parseBackupJson(await downloadBackup(fileId));
      const writer = makeImportWriter(db, userId);
      const preview = await validate(data, writer);

      const ok = await confirmAsync(
        'Ripristinare questo backup?',
        `${fileName}\n${preview.valid.length} rifornimenti da ripristinare, ` +
        `${preview.duplicates.length} già presenti (saltati), ` +
        `${preview.newVehicles.length} veicoli da creare.`,
        'Ripristina'
      );
      if (!ok) return;

      const result = await commit(preview, data.vehicles, writer);
      setStatus(
        `Ripristino completato: ${result.refuelsImported} rifornimenti, ` +
        `${result.vehiclesCreated} veicoli creati.`
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!DRIVE_SUPPORTED) {
    return (
      <View style={s.center}>
        <Text style={s.title}>Backup Google Drive</Text>
        <Text style={s.muted}>
          Il backup su Drive è disponibile solo nell'app Android: è lì che
          vivono i dati offline. Il web legge già tutto da Supabase.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={s.container}>

      <View style={s.card}>
        <Text style={s.cardTitle}>
          {connected ? 'Google Drive collegato' : 'Google Drive non collegato'}
        </Text>
        <Text style={s.muted}>
          {lastBackup
            ? `Ultimo backup: ${fmtDateTime(lastBackup)}`
            : 'Nessun backup eseguito finora.'}
        </Text>
        <Text style={s.muted}>
          Backup automatico all'apertura dell'app se sono passati più di{' '}
          {BACKUP_INTERVAL_DAYS} giorni. Vengono conservati gli ultimi 10.
        </Text>
      </View>

      {!connected ? (
        <Pressable style={s.primaryBtn} disabled={busy} onPress={connect}>
          <Text style={s.primaryBtnText}>
            {busy ? 'Attendi…' : 'Collega Google Drive'}
          </Text>
        </Pressable>
      ) : (
        <>
          <Pressable style={s.primaryBtn} disabled={busy} onPress={runBackup}>
            <Text style={s.primaryBtnText}>
              {busy ? 'Attendi…' : 'Esegui backup adesso'}
            </Text>
          </Pressable>

          <Text style={s.sectionTitle}>Backup su Drive</Text>
          {backups.length === 0 && (
            <Text style={s.muted}>Nessun backup trovato nella cartella FuelTracker.</Text>
          )}
          {backups.map((b) => (
            <View key={b.id} style={s.backupRow}>
              <View style={s.backupInfo}>
                <Text style={s.backupName}>{b.name}</Text>
                <Text style={s.backupDate}>{fmtDateTime(b.createdTime)}</Text>
              </View>
              <Pressable
                style={s.restoreBtn}
                disabled={busy}
                onPress={() => restore(b.id, b.name)}
              >
                <Text style={s.restoreBtnText}>Ripristina</Text>
              </Pressable>
            </View>
          ))}

          <Pressable style={s.secondaryBtn} disabled={busy} onPress={disconnect}>
            <Text style={s.secondaryBtnText}>Scollega Google Drive</Text>
          </Pressable>
        </>
      )}

      {status && <Text style={s.status}>{status}</Text>}

    </ScrollView>
  );
}

const c = {
  bg: '#FFFFFF', text: '#1A1D21', muted: '#6B7280',
  border: '#D1D5DB', accent: '#0F6E5D', cardBg: '#F4F6F5',
  danger: '#B91C1C',
};

const s = StyleSheet.create({
  container: { padding: 20, gap: 12, backgroundColor: c.bg },
  center: { flex: 1, padding: 24, gap: 8, justifyContent: 'center', backgroundColor: c.bg },
  title: { fontSize: 18, fontWeight: '700', color: c.text, textAlign: 'center' },
  card: { backgroundColor: c.cardBg, borderRadius: 12, padding: 14, gap: 6 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: c.text },
  muted: { fontSize: 13, color: c.muted, lineHeight: 18, textAlign: 'left' },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: c.text, marginTop: 12 },
  backupRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 12,
  },
  backupInfo: { flex: 1, gap: 2 },
  backupName: { fontSize: 13, fontWeight: '600', color: c.text },
  backupDate: { fontSize: 12, color: c.muted },
  restoreBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  restoreBtnText: { color: c.accent, fontSize: 14, fontWeight: '600' },
  primaryBtn: {
    backgroundColor: c.accent, borderRadius: 12,
    paddingVertical: 15, alignItems: 'center',
  },
  primaryBtnText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  secondaryBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  secondaryBtnText: { color: c.danger, fontSize: 14, fontWeight: '600' },
  status: { fontSize: 14, color: c.text, marginTop: 8 },
});
