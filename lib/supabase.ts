// ============================================================
// FuelTracker — Client Supabase condiviso (lib/supabase.ts)
//
// Differenze per piattaforma gestite qui, una volta sola:
//   - nativo: sessione in AsyncStorage, niente detectSessionInUrl
//   - web:    localStorage (default) + detectSessionInUrl per i
//             link di conferma email
// Su nativo l'auto-refresh del token va legato ad AppState
// (raccomandazione Supabase per React Native): senza, il token
// scade quando l'app resta a lungo in background.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(url, anonKey, {
  auth: {
    ...(Platform.OS !== 'web' ? { storage: AsyncStorage } : {}),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});

if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
