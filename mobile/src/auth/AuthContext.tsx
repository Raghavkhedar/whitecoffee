import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import type { UserProfile } from '../attendance/attendanceApi';

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Mirrors Android's FirebaseAuthRepository.resolveLoginEmail: employees can log in with
// either a real email or their Employee ID, which the admin portal mints into a
// synthetic "<employeeId>@whitecoffee.internal" address at account-creation time.
const LOGIN_EMAIL_DOMAIN = 'whitecoffee.internal';

function resolveLoginEmail(identifier: string): string {
  const trimmed = identifier.trim().toLowerCase();
  return trimmed.includes('@') ? trimmed : `${trimmed}@${LOGIN_EMAIL_DOMAIN}`;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser: User | null) => {
      if (!firebaseUser) {
        setUser(null);
        setLoading(false);
        return;
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

  async function login(email: string, password: string) {
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, resolveLoginEmail(email), password);
    } catch (e) {
      console.error('Login failed', e);
      setError('Login failed. Check your email and password.');
      throw e;
    }
  }

  async function logout() {
    await signOut(auth);
  }

  return (
    <AuthContext.Provider value={{ user, loading, error, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
