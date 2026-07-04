// ============================================================
// FuelTracker — Login (app/login.tsx)
//
// Email + password: il flusso più semplice che funziona identico
// su Android e web senza configurare deep link (che il magic
// link richiederebbe su nativo). Per uso personale è la scelta
// giusta; se diventerà prodotto si potrà aggiungere OAuth.
//
// Il redirect post-login lo fa l'AuthGate nel layout root:
// questa schermata non naviga mai da sola.
// ============================================================

import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { supabase } from '../lib/supabase';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const canSubmit = email.includes('@') && password.length >= 6 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setMessage(null);

    const { error, data } =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    if (error) {
      setMessage(
        /invalid login credentials/i.test(error.message)
          ? 'Email o password errate.'
          : error.message
      );
    } else if (mode === 'signup' && !data.session) {
      // con la conferma email attiva su Supabase la sessione
      // arriva solo dopo il click sul link
      setMessage('Controlla la posta e conferma la registrazione.');
    }
    setBusy(false);
  };

  return (
    <KeyboardAvoidingView
      style={s.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={s.container}>
        <Text style={s.title}>FuelTracker</Text>

        <TextInput
          style={s.input}
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
        />
        <TextInput
          style={s.input}
          value={password}
          onChangeText={setPassword}
          placeholder="Password (min. 6 caratteri)"
          secureTextEntry
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
        />

        {message && <Text style={s.message}>{message}</Text>}

        <Pressable
          style={[s.btn, !canSubmit && s.btnDisabled]}
          disabled={!canSubmit}
          onPress={submit}
        >
          <Text style={s.btnText}>
            {busy ? 'Attendere…' : mode === 'signin' ? 'Accedi' : 'Registrati'}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setMessage(null);
          }}
        >
          <Text style={s.switchText}>
            {mode === 'signin'
              ? 'Non hai un account? Registrati'
              : 'Hai già un account? Accedi'}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const c = {
  bg: '#FFFFFF', text: '#1A1D21', muted: '#6B7280',
  border: '#D1D5DB', accent: '#0F6E5D', error: '#B45309',
};

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: c.bg },
  container: {
    flex: 1, justifyContent: 'center', padding: 24, gap: 12,
    maxWidth: 420, width: '100%', alignSelf: 'center', // leggibile anche su web
  },
  title: {
    fontSize: 28, fontWeight: '700', color: c.accent,
    textAlign: 'center', marginBottom: 16,
  },
  input: {
    borderWidth: 1, borderColor: c.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: c.text,
  },
  message: { color: c.error, fontSize: 14 },
  btn: {
    backgroundColor: c.accent, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center', marginTop: 8,
  },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  switchText: { color: c.muted, textAlign: 'center', marginTop: 12, fontSize: 14 },
});
