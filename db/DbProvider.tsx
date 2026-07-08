// ============================================================
// FuelTracker — DbProvider (versione NATIVA: db/DbProvider.tsx)
//
// Espone useDb() alle schermate. Su Android incapsula
// SQLiteProvider + migrazioni; su web (DbProvider.web.tsx) è un
// passthrough che ritorna null, perché il DAL web ignora il db.
// Le schermate importano SOLO useDb(): mai expo-sqlite diretto,
// altrimenti la build web si rompe.
// ============================================================

import { type ReactNode } from 'react';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { migrate } from './schema';

export function DbProvider({ children }: { children: ReactNode }) {
  return (
    <SQLiteProvider databaseName="fueltracker.db" onInit={migrate}>
      {children}
    </SQLiteProvider>
  );
}

export function useDb() {
  return useSQLiteContext();
}
