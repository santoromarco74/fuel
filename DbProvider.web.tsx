// ============================================================
// FuelTracker — DbProvider versione WEB (db/DbProvider.web.tsx)
// Nessun SQLite nel browser: il DAL web parla con Supabase e
// ignora il parametro db. Stessa API della versione nativa.
// ============================================================

import { type ReactNode } from 'react';

export function DbProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useDb(): unknown {
  return null;
}
