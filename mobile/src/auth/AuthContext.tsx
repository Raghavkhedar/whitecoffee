import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { doc, getDoc, onSnapshot, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import type { UserProfile } from '../attendance/attendanceApi';
import { accountStatusFrom, isSessionSuperseded, newSessionToken, type AccountStatus } from './accountStatus';

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  error: string | null;
  accountStatus: AccountStatus;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Mirrors Android's FirebaseAuthRepository.resolveLoginEmail: employees can log in with
// either a real email or their Employee ID, which the admin portal mints into a
// synthetic "<employeeId>@whitecoffee.internal" address at account-creation time.
const LOGIN_EMAIL_DOMAIN = 'whitecoffee.internal';

// This device's single-device session token, stored with the uid it belongs to so a token from
// a previous account on the same phone is never compared against another user's doc.
const SESSION_TOKEN_KEY = 'wc.sessionToken';

async function readStoredToken(uid: string): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { uid?: string; token?: string };
    return parsed.uid === uid && parsed.token ? parsed.token : null;
  } catch {
    return null;
  }
}

async function clearStoredToken(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {
    // Best effort — a stale token for this uid only means a later kick check can fire.
  }
}

function resolveLoginEmail(identifier: string): string {
  const trimmed = identifier.trim().toLowerCase();
  return trimmed.includes('@') ? trimmed : `${trimmed}@${LOGIN_EMAIL_DOMAIN}`;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accountStatus, setAccountStatus] = useState<AccountStatus>({ kind: 'active' });
  // The token this device holds, read by the account listener on every snapshot. A ref, not
  // state, so login can set it BEFORE issuing the Firestore write — the write is applied to
  // the local cache immediately, and the listener must never see our own new token while
  // still holding the old one (that would kick the session that just logged in).
  const localTokenRef = useRef<string | null>(null);
  const kickingRef = useRef(false);

  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser: User | null) => {
      if (!firebaseUser) {
        localTokenRef.current = null;
        setAccountStatus({ kind: 'active' });
        setUser(null);
        setLoading(false);
        return;
      }
      // Restored session: adopt the token saved at this device's last login, if any. During
      // an interactive login the stored token was cleared first, so this reads null and
      // login() sets the fresh one itself.
      if (!localTokenRef.current) {
        const stored = await readStoredToken(firebaseUser.uid);
        // Re-check after the await: login() may have set the fresh token meanwhile.
        if (!localTokenRef.current) localTokenRef.current = stored;
      }
      try {
        const profileSnap = await getDoc(doc(db, 'users', firebaseUser.uid));
        const profile = profileSnap.data();
        setUser({
          uid: firebaseUser.uid,
          employeeId: profile?.employeeId ?? '',
          name: profile?.name ?? '',
          // No default role: an unknown role must not enable the office flow, because
          // office-shaped punches are invisible to another role's payroll scoring.
          role: profile?.role ?? '',
        });
      } catch (e) {
        console.error('Failed to load user profile', e);
        // Fail closed — the profile fetch failing is not evidence of an office role.
        setUser({ uid: firebaseUser.uid, employeeId: '', name: '', role: '' });
      } finally {
        setLoading(false);
      }
    });
  }, []);

  // Watch users/{uid} for suspension and for another device taking over the account.
  useEffect(() => {
    if (!user?.uid) return;
    const uid = user.uid;
    kickingRef.current = false;
    return onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        setAccountStatus(accountStatusFrom(data));
        if (!kickingRef.current && isSessionSuperseded(data.activeSessionToken, localTokenRef.current)) {
          kickingRef.current = true;
          // A plain sign-out, deliberately NOT an auto-checkout: the other device now owns
          // this account's day, and closing it from here would end what that device opened.
          localTokenRef.current = null;
          clearStoredToken();
          signOut(auth).catch((e) => console.error('Sign-out after session takeover failed', e));
          Alert.alert('Signed out', 'Signed in on another device. Please log in again.');
        }
      },
      // Swallowed like Android: keeping the last good snapshot is the safe default, and
      // `active` defaults to true, so an unreadable doc never locks anyone out.
      (e) => console.warn('Account watch failed', e),
    );
  }, [user?.uid]);

  async function login(email: string, password: string) {
    setError(null);
    try {
      const token = newSessionToken();
      localTokenRef.current = null;
      await clearStoredToken();
      const credential = await signInWithEmailAndPassword(auth, resolveLoginEmail(email), password);
      const uid = credential.user.uid;
      try {
        await AsyncStorage.setItem(SESSION_TOKEN_KEY, JSON.stringify({ uid, token }));
      } catch {
        // Not persisted: this session just won't be enforced after an app restart.
      }
      localTokenRef.current = token;
      // Fire-and-forget (awaiting hangs offline). ⚠️ AUDIT-EXEMPT, exactly like Android: the
      // owner-update rule is changedKeysWithin(['activeSessionToken', 'fcmToken']) plus the
      // stamp, so this must stay a single-key write — any extra key is PERMISSION_DENIED.
      updateDoc(doc(db, 'users', uid), { activeSessionToken: token }).catch((e) =>
        console.error('Failed to record session token', e),
      );
    } catch (e) {
      console.error('Login failed', e);
      setError('Login failed. Check your email and password.');
      throw e;
    }
  }

  async function logout() {
    localTokenRef.current = null;
    await clearStoredToken();
    await signOut(auth);
  }

  return (
    <AuthContext.Provider value={{ user, loading, error, accountStatus, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
