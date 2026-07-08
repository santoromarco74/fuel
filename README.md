# FuelTracker

Monitoraggio consumi carburante. Android offline-first (SQLite + outbox → Supabase), web online (Supabase diretto). Stessa codebase Expo (SDK 57, expo-router).

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
  consumption.test.ts      # 16 verifiche — eseguire con: npx tsx
import/
  pipeline.ts              # validate/commit + Writer astratto
  genericCsv.ts            # profilo CSV generico con mappatura colonne
  backup.ts                # formato backup JSON + profilo restore
  pipeline.test.ts         # 21 verifiche end-to-end
drive/
  auth.ts                  # OAuth Google PKCE (solo Android)
  backup.ts                # upload/list/restore su Drive + rotazione (10)
auth/
  useSession.ts            # sessione Supabase + userId per il DAL
lib/
  supabase.ts              # client condiviso (storage per piattaforma)
app/
  _layout.tsx              # root: DbProvider + auth gate + trigger di sync
  index.tsx                # home: lista veicoli + stato sync
  login.tsx                # login email/password Supabase
  vehicle/new.tsx          # nuovo veicolo
  refuel/new.tsx           # inserimento rifornimento
  stats/[vehicleId].tsx    # statistiche + grafici SVG
```

## Setup

```bash
npm install
npm test          # entrambe le suite (consumi + pipeline import)
npm run typecheck # tsc --noEmit
npm start         # expo start
```

## Configurazione

1. **Supabase**: eseguire `schema.sql` nel SQL Editor. URL + anon key nelle
   variabili `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
2. **Google Cloud Console** (solo per il backup Drive): progetto → consent
   screen → client ID **Android** (package + SHA-1 da `eas credentials`) →
   abilitare Drive API → client ID in `EXPO_PUBLIC_GOOGLE_CLIENT_ID`.
   Nota: in modalità "testing" il refresh token dura 7 giorni.
   Lo scheme OAuth (`fueltracker`) è già configurato in `app.json`.

## Pezzi ancora aperti

- Storico rifornimenti e UI import (mappatura colonne + anteprima)
- Writer d'import concreti: sono ~20 righe ciascuno sopra il DAL
  (l'interfaccia è `ImportWriter` in `import/pipeline.ts`)
- UI per gli item di sync bloccati (`listStuckItems` / `discardStuckItem`
  in `sync/engine.ts`)
- Schermata impostazioni backup
- Profili Fuelio e Drivvo: servono export reali per scrivere i parser
- Backup Drive lato web: fuori scope per scelta (il web legge da Supabase)
- Primo test end-to-end su dispositivo

## Test

```bash
npx tsx stats/consumption.test.ts     # logica consumi (16 assert)
npx tsx import/pipeline.test.ts       # pipeline import (21 assert)
```
