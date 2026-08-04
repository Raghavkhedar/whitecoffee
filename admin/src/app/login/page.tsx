'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { hasPortalAccess, landingPath } from '@/lib/portalAccess';
import { resolveLoginEmail } from '@/lib/constants';
import type { User } from '@/types';

export default function LoginPage() {
  const router = useRouter();
  // Whatever was typed — an employee ID or a full email. resolveLoginEmail() decides.
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // Same resolution the Android app uses, so one identifier works on both.
      const result = await signInWithEmailAndPassword(auth, resolveLoginEmail(identifier), password);
      const userDoc = await getDoc(doc(db, 'users', result.user.uid));
      // Admins and tagged portal staff (e.g. attendance managers) may enter; everyone
      // else is denied. Send them to the first tab their access allows.
      const u = userDoc.exists() ? ({ id: userDoc.id, ...userDoc.data() } as User) : null;
      if (!u || !hasPortalAccess(u)) {
        await auth.signOut();
        setError('Access denied. This portal is for admins and tagged staff only.');
        return;
      }
      router.replace(landingPath(u));
    } catch {
      // Firebase's email-enumeration protection returns one generic error for both a
      // wrong password and an account that does not exist, so this message must cover
      // both honestly rather than claim the password was wrong.
      setError('Incorrect employee ID / email or password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">☕</div>
          <h1 className="text-2xl font-bold text-text-primary">WhiteCoffee Admin</h1>
          <p className="text-text-secondary text-sm mt-1">Senken Engineering — Operations Portal</p>
        </div>

        <div className="card">
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="label">Employee ID or Email</label>
              {/* ⚠️ type="text", NOT "email". An employee ID like "S464" fails the
                  browser's native email validation, which silently blocks the submit
                  before any of our code runs. */}
              <input
                type="text"
                className="input"
                placeholder="S464 or admin@senken.com"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">Password</label>
              <input
                type="password"
                className="input"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
