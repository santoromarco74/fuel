// ============================================================
// FuelTracker — Conferma modale cross-platform (lib/confirm.ts)
//
// Su nativo usa Alert.alert; sul web (confirm.web.ts) usa
// window.confirm, perché Alert di react-native-web è un no-op
// e una conferma che non appare mai equivale a un "no" eterno.
// Le schermate importano SOLO questa funzione: mai Platform.OS.
// ============================================================

import { Alert } from 'react-native';

export function confirmAsync(
  title: string,
  message: string,
  confirmLabel = 'OK',
  destructive = false
): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Annulla', style: 'cancel', onPress: () => resolve(false) },
      {
        text: confirmLabel,
        style: destructive ? 'destructive' : 'default',
        onPress: () => resolve(true),
      },
    ])
  );
}
