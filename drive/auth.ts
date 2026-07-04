// ============================================================
// FuelTracker — Google OAuth per il backup su Drive
//
// Flusso: authorization code + PKCE con expo-auth-session
// (nessun client secret nell'app). Token in expo-secure-store.
// Scope minimo: drive.file — l'app vede SOLO i file creati da lei.
//
// Prerequisiti su Google Cloud Console (una tantum):
//   1. progetto + OAuth consent screen (external, modalità testing
//      va bene per uso personale: refresh token valido 7 giorni
//      finché l'app non è verificata)
//   2. credenziale "OAuth client ID" di tipo Android
//      (package name + SHA-1 del keystore EAS)
//   3. abilitare la Google Drive API
// ============================================================

import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';

const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID!;
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
};

const STORE_KEY = 'google_drive_tokens';

interface StoredTokens {
  accessToken: string;
  refreshToken: string | null;
  /** epoch ms di scadenza dell'access token */
  expiresAt: number;
}

// ---------- storage ----------

async function loadTokens(): Promise<StoredTokens | null> {
  const raw = await SecureStore.getItemAsync(STORE_KEY);
  return raw ? (JSON.parse(raw) as StoredTokens) : null;
}

async function saveTokens(t: StoredTokens): Promise<void> {
  await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(t));
}

export async function disconnectDrive(): Promise<void> {
  await SecureStore.deleteItemAsync(STORE_KEY);
}

export async function isDriveConnected(): Promise<boolean> {
  return (await loadTokens()) !== null;
}

// ---------- login interattivo (da chiamare da un pulsante) ----------

export async function connectDrive(): Promise<boolean> {
  const redirectUri = AuthSession.makeRedirectUri({
    scheme: 'fueltracker', // deve combaciare con "scheme" in app.json
  });

  const request = new AuthSession.AuthRequest({
    clientId: GOOGLE_CLIENT_ID,
    scopes: SCOPES,
    redirectUri,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    extraParams: {
      access_type: 'offline',   // chiedi il refresh token
      prompt: 'consent',        // forzalo anche ai login successivi
    },
  });

  const result = await request.promptAsync(discovery);
  if (result.type !== 'success' || !result.params.code) return false;

  const tokens = await AuthSession.exchangeCodeAsync(
    {
      clientId: GOOGLE_CLIENT_ID,
      code: result.params.code,
      redirectUri,
      extraParams: { code_verifier: request.codeVerifier ?? '' },
    },
    discovery
  );

  await saveTokens({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? null,
    expiresAt: Date.now() + (tokens.expiresIn ?? 3600) * 1000,
  });
  return true;
}

// ---------- access token valido (refresh trasparente) ----------

/**
 * Restituisce un access token valido, rinnovandolo se scaduto.
 * Ritorna null se serve un nuovo login interattivo (refresh token
 * assente, revocato, o scaduto — es. i 7 giorni della modalità
 * testing): la UI deve mostrare "Riconnetti Google Drive".
 */
export async function getAccessToken(): Promise<string | null> {
  const stored = await loadTokens();
  if (!stored) return null;

  // margine di 60s per evitare di usare un token al limite
  if (Date.now() < stored.expiresAt - 60_000) return stored.accessToken;

  if (!stored.refreshToken) return null;

  try {
    const refreshed = await AuthSession.refreshAsync(
      { clientId: GOOGLE_CLIENT_ID, refreshToken: stored.refreshToken },
      discovery
    );
    await saveTokens({
      accessToken: refreshed.accessToken,
      // Google può non rimandare il refresh token: conserva il vecchio
      refreshToken: refreshed.refreshToken ?? stored.refreshToken,
      expiresAt: Date.now() + (refreshed.expiresIn ?? 3600) * 1000,
    });
    return refreshed.accessToken;
  } catch {
    // refresh token non più valido: serve login interattivo
    return null;
  }
}
