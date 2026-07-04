# FuelTracker

App di monitoraggio consumi carburante. Una codebase Expo (React Native):
Android offline-first + web di consultazione. Backend Supabase.

## Architettura (decisioni già prese: non ridiscuterle senza motivo)

- **Android è offline-first**: SQLite locale (`expo-sqlite`) è la fonte di
  verità, sync verso Supabase con pattern outbox manuale. **Niente
  WatermelonDB, niente PowerSync**: scelta deliberata.
- **Il web è solo online**: parla direttamente con Supabase. Nessun SQLite
  nel browser.
- **Split per piattaforma via Metro**: `dal.web.ts`, `DbProvider.web.tsx`,
  `engine.web.ts`. Le schermate hanno import identici e NON devono
  contenere `Platform.OS` per la scelta della fonte dati.
- Le schermate usano **solo `useDb()`** da `db/DbProvider`: mai importare
  `expo-sqlite` direttamente in una schermata (rompe la build web).
- ID: **UUID generati client-side**, sempre.
- Cancellazioni: **soft delete** (`deleted_at`), mai DELETE fisiche —
  servono alla propagazione del sync.

## Invarianti da non violare MAI

1. **Scrittura atomica dato + outbox**: nel DAL nativo (`db/dal.ts`) ogni
   scrittura su vehicles/refuels e il relativo INSERT in `sync_queue`
   stanno nella stessa transazione.
2. **Il push del sync è FIFO e si ferma al primo errore**
   (`sync/engine.ts`): l'ordine preserva la coerenza insert→update.
3. **Il cursore di pull (`last_pulled_at`) usa gli `updated_at` del
   server**, mai l'orologio del dispositivo.
4. **`total_cost` è colonna generata su Postgres**: non va mai inviata
   negli insert/update verso Supabase.
5. **La logica consumi esiste in DUE posti** e deve restare allineata:
   vista SQL `v_consumption` (schema.sql) e `stats/consumption.ts`.
   Se ne modifichi una, modifica l'altra e aggiorna il test.
6. Item di sync falliti: mai scartati in silenzio (restano in coda,
   `listStuckItems` li espone alla UI).
7. Le medie di consumo sono **ponderate** (km tot / litri tot), mai
   media delle medie per segmento.

## Test (eseguire dopo ogni modifica alle aree relative)

```bash
npx tsx stats/consumption.test.ts     # logica consumi (14 assert)
npx tsx import/pipeline.test.ts       # pipeline import (21 assert)
```

## Convenzioni

- Lingua UI e commenti: **italiano**. Formati italiani: virgola decimale
  accettata in input, date dd/mm/yyyy nell'import.
- Stile modifiche: incrementali e chirurgiche; in caso di instabilità,
  rollback a uno stato stabile prima di riprovare.
- Grafici: SVG custom con `react-native-svg`. Non introdurre librerie di
  charting senza discuterne prima.
- Import: ogni nuovo formato è un profilo che produce `IntermediateImport`
  (`import/pipeline.ts`); la pipeline validate/commit non si tocca.
- I parser Fuelio/Drivvo vanno scritti SOLO su file di export reali,
  mai sul formato presunto.

## Stato del progetto

Fatto: schema Supabase (RLS, trigger, vista), schema SQLite + DAL,
schermate (login, home, nuovo veicolo, nuovo rifornimento, statistiche),
sync engine, pipeline import + CSV generico + backup JSON, backup Google
Drive (solo Android), layout root con auth gate.

Da fare: UI import (mappatura colonne + anteprima), writer d'import
concreti sopra il DAL, storico rifornimenti, schermata impostazioni
backup, parser Fuelio e Drivvo (attendono export reali), primo test
end-to-end su dispositivo.

## Setup non ancora eseguito (vedi README.md per i dettagli)

- `schema.sql` da eseguire nel SQL Editor di Supabase
- variabili `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`,
  `EXPO_PUBLIC_GOOGLE_CLIENT_ID`
- `"scheme": "fueltracker"` in app.json
- Google Cloud Console per il backup Drive (client ID Android + SHA-1
  da `eas credentials`); in modalità testing il refresh token dura 7 giorni
