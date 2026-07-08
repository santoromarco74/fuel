// ============================================================
// FuelTracker — useSession (auth/useSession.ts)
//
// L'hook che le schermate già importano (vedi app/refuel/new.tsx).
// Un solo punto di verità sulla sessione, alimentato da
// onAuthStateChange.
//
// Nota offline: la sessione persistita viene letta dallo storage
// locale, quindi l'app Android si apre e funziona ANCHE senza
// rete dopo il primo login. Solo il primo login richiede
// connessione.
// ============================================================

import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export interface SessionState {
  session: Session | null;
  /** comodo per il DAL: '' finché non c'è sessione */
  userId: string;
  /** true finché la sessione iniziale non è stata letta dallo storage */
  loading: boolean;
}

export function useSession(): SessionState {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return {
    session,
    userId: session?.user.id ?? '',
    loading,
  };
}

export const signOut = () => supabase.auth.signOut();
