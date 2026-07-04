# FuelTracker — Guida di assemblaggio

Monitoraggio consumi carburante. Android offline-first (SQLite + outbox → Supabase), web online (Supabase diretto). Stessa codebase Expo.

## Struttura

```
schema.sql                 # Supabase: tabelle, RLS, trigger, vista v_consumption
types.ts                   # tipi condivisi + tipi sync
db/
  schema.ts                # SQLite locale + migrazioni (PRAGMA user_version)
  dal.ts                   # DAL nativo: scritture atomiche dato+outbox
  dal.web.ts               # DAL web: stessa API, su Supabase (Metro sceglie da solo)
  DbProvider.tsx / .web.tsx# useDb(): SQLite su nativo, no-op su web
sync/
  engine.ts / engine.web.ts# push FIFO + pull incrementale / no-op su web
stats/
  consumption.ts           # calcolo consumi (replica TS della vista SQL)
  consumption.test.ts      # 14 verifiche — eseguire con: npx tsx
import/
  pipeline.ts              # validate/commit + Writer astratto
  genericCsv.ts            # profilo CSV generico con mappatura colonne
  backup.ts                # formato backup JSON + profilo restore
  pipeline.test.ts         # 21 verifiche end-to-end
drive/
  auth.ts                  # OAuth Google PKCE (solo Android)
  backup.ts                # upload/list/restore su Drive + rotazione (10)
app/
  refuel/new.tsx           # inserimento rifornimento
  stats/[vehicleId].tsx    # statistiche + grafici SVG
```

## Dipendenze

```bash
npx create-expo-app fueltracker && cd fueltracker
npx expo install expo-sqlite expo-crypto expo-secure-store expo-auth-session \
  expo-document-picker react-native-svg @react-native-community/netinfo \
  @react-native-async-storage/async-storage
npm i @supabase/supabase-js papaparse
npm i -D @types/papaparse tsx
```

## Configurazione

1. **Supabase**: eseguire `schema.sql` nel SQL Editor. Creare `lib/supabase.ts`
   con il client (URL + anon key in `EXPO_PUBLIC_SUPABASE_URL` / `_ANON_KEY`).
2. **app.json**: `"scheme": "fueltracker"` (serve al redirect OAuth).
3. **Google Cloud Console** (solo per il backup Drive): progetto → consent
   screen → client ID **Android** (package + SHA-1 da `eas credentials`) →
   abilitare Drive API → client ID in `EXPO_PUBLIC_GOOGLE_CLIENT_ID`.
   Nota: in modalità "testing" il refresh token dura 7 giorni.
4. **Layout root** (`app/_layout.tsx`): avvolgere con `<DbProvider>`,
   chiamare `registerSyncTriggers(db, supabase)` in un `useEffect` (con la
   cleanup) e `backupIfDue(...)` all'avvio. Manca ancora `auth/useSession.ts`
   (hook che espone lo userId Supabase): da scrivere quando si configura
   il login.

## Pezzi ancora aperti

- Autenticazione Supabase (login email/password o magic link) + `useSession`
- Schermate: lista veicoli, storico rifornimenti, UI import (mappatura
  colonne + anteprima), impostazioni backup
- Writer d'import concreti: sono ~20 righe ciascuno sopra il DAL
  (l'interfaccia è `ImportWriter` in `import/pipeline.ts`)
- Profili Fuelio e Drivvo: servono export reali per scrivere i parser
- Backup Drive lato web: fuori scope per scelta (il web legge da Supabase)

## Test

```bash
npx tsx stats/consumption.test.ts     # logica consumi
npx tsx import/pipeline.test.ts       # pipeline import
```

Il calcolo consumi esiste in due posti (vista SQL `v_consumption` e
`stats/consumption.ts`): se si cambia una logica, cambiarla in entrambi.
Il test è la rete di sicurezza.

## Build

```bash
# Android
eas build --platform android --profile preview   # APK di test
# Web (statico: va bene qualsiasi hosting, anche il vhosting di algorastudio.it)
npx expo export --platform web                   # output in dist/
```
