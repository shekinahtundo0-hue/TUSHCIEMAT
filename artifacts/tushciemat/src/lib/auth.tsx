import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider, getAuth, onAuthStateChanged, signInWithRedirect, signOut as firebaseSignOut, type User,
} from 'firebase/auth';
import { useQueryClient } from '@tanstack/react-query';
import { setAuthTokenGetter } from '@workspace/api-client-react';

const env = import.meta.env;
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
};
const missing = Object.entries(firebaseConfig).filter(([, value]) => !value).map(([key]) => key);
if (missing.length) {
  throw new Error(`Missing Firebase web config (${missing.join(', ')}). Copy .env.example to .env and fill in the VITE_FIREBASE_* values.`);
}

export const auth = getAuth(initializeApp(firebaseConfig));

// Sends the Firebase ID token as a bearer header; the SDK refreshes it before it expires.
setAuthTokenGetter(() => auth.currentUser ? auth.currentUser.getIdToken() : null);

type AuthState = {
  user: User | null;
  ready: boolean;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const state = useContext(AuthContext);
  if (!state) throw new Error('useAuth must be used inside AuthProvider');
  return state;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);
  const previousUid = useRef<string | null | undefined>(undefined);

  useEffect(() => onAuthStateChanged(auth, (next) => {
    const uid = next?.uid ?? null;
    if (previousUid.current !== undefined && previousUid.current !== uid) client.clear();
    previousUid.current = uid;
    setUser(next);
    setReady(true);
  }), [client]);

  const refresh = useCallback(async () => {
    const current = auth.currentUser;
    if (!current) return;
    await current.reload();
    await current.getIdToken(true);
    setVersion((v) => v + 1);
  }, []);

  // `version` forces consumers to re-read mutable fields such as `emailVerified` on the same User object.
  const value = useMemo<AuthState>(() => ({ user, ready, refresh }), [user, ready, refresh, version]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function signOut() {
  return firebaseSignOut(auth);
}

export function signInWithGoogle() {
  return signInWithRedirect(auth, new GoogleAuthProvider());
}

const SILENT = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled']);

const MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'That email and password don’t match an account.',
  'auth/invalid-login-credentials': 'That email and password don’t match an account.',
  'auth/wrong-password': 'That email and password don’t match an account.',
  'auth/user-not-found': 'That email and password don’t match an account.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/missing-password': 'Enter your password.',
  'auth/email-already-in-use': 'An account already exists for this email. Sign in instead.',
  'auth/weak-password': 'Choose a stronger password of at least 8 characters.',
  'auth/password-does-not-meet-requirements': 'Choose a stronger password of at least 8 characters.',
  'auth/too-many-requests': 'Too many attempts. Please wait a few minutes and try again.',
  'auth/network-request-failed': 'We couldn’t reach the sign-in service. Check your connection and try again.',
  'auth/user-disabled': 'This account has been disabled. Contact your school administrator.',
  'auth/popup-blocked': 'Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.',
  'auth/account-exists-with-different-credential': 'This email already uses a different sign-in method. Sign in with email and password instead.',
  'auth/unauthorized-domain': 'Sign-in isn’t enabled for this web address yet.',
  'auth/operation-not-allowed': 'This sign-in method isn’t enabled yet.',
  'auth/requires-recent-login': 'Please sign in again to continue.',
};

export function authMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : '';
  if (SILENT.has(code)) return '';
  return MESSAGES[code] ?? fallback;
}
