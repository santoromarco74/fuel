// ============================================================
// FuelTracker — Layout root (app/_layout.tsx)
//
// Qui si collega tutto ciò che è stato costruito:
//   - DbProvider (SQLite su nativo, passthrough su web)
//   - guardia di autenticazione (redirect a /login)
//   - registerSyncTriggers: parte solo A SESSIONE ATTIVA
//     (senza auth il push fallirebbe contro le RLS)
//   - backupIfDue all'avvio (no-op se Drive non è collegato;
//     su web è comunque escluso per scelta di progetto)
// ============================================================

import { useEffect } from 'react';
import { View, ActivityIndicator, Platform } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { DbProvider, useDb } from '../db/DbProvider';
import { useSession } from '../auth/useSession';
import { supabase } from '../lib/supabase';
import { registerSyncTriggers } from '../sync/engine';
import { backupIfDue } from '../drive/backup';
import { listVehicles, listRefuels } from '../db/dal';

function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, loading } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const onLogin = segments[0] === 'login';
    if (!session && !onLogin) router.replace('/login');
    if (session && onLogin) router.replace('/');
  }, [session, loading, segments, router]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  return <>{children}</>;
}

function SyncAndBackup() {
  const db = useDb();
  const { session } = useSession();

  useEffect(() => {
    if (!session) return;

    // sync: su web è il no-op di engine.web.ts
    const cleanup = registerSyncTriggers(db as never, supabase);

    // backup Drive: solo Android, solo se collegato e "scaduto"
    if (Platform.OS !== 'web') {
      backupIfDue(async () => {
        const vehicles = await listVehicles(db as never);
        const refuels = (
          await Promise.all(vehicles.map((v) => listRefuels(db as never, v.id)))
        ).flat();
        return { vehicles, refuels };
      }).catch(() => {
        // il backup non deve mai bloccare l'avvio: gli errori
        // emergono dalla schermata impostazioni, non qui
      });
    }

    return cleanup;
  }, [db, session]);

  return null;
}

export default function RootLayout() {
  return (
    <DbProvider>
      <AuthGate>
        <SyncAndBackup />
        <Stack>
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="index" options={{ title: 'FuelTracker' }} />
          <Stack.Screen name="refuel/new" options={{ title: 'Nuovo rifornimento' }} />
          <Stack.Screen name="refuel/[vehicleId]" options={{ title: 'Storico rifornimenti' }} />
          <Stack.Screen name="refuel/edit/[refuelId]" options={{ title: 'Modifica rifornimento' }} />
          <Stack.Screen name="vehicle/new" options={{ title: 'Nuovo veicolo' }} />
          <Stack.Screen name="stats/[vehicleId]" options={{ title: 'Statistiche' }} />
          <Stack.Screen name="sync" options={{ title: 'Sincronizzazione' }} />
          <Stack.Screen name="import/index" options={{ title: 'Importa dati' }} />
          <Stack.Screen name="backup" options={{ title: 'Backup Google Drive' }} />
        </Stack>
      </AuthGate>
    </DbProvider>
  );
}
