'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import Sidebar from '@/components/Sidebar';
import Header from '@/components/Header';
import { AccessProvider } from '@/components/AccessContext';
import { hasPortalAccess, canAccess, landingPath } from '@/lib/portalAccess';
import type { User } from '@/types';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const [user, setUser]   = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async fbUser => {
      if (!fbUser) { router.replace('/login'); return; }
      const snap = await getDoc(doc(db, 'users', fbUser.uid));
      const u = snap.exists() ? ({ id: snap.id, ...snap.data() } as User) : null;
      // Admins and users with a recognized tag get in; everyone else is bounced.
      if (!u || !hasPortalAccess(u)) {
        await auth.signOut();
        router.replace('/login');
        return;
      }
      setUser(u);
      setReady(true);
    });
    return unsub;
  }, [router]);

  // Central per-tab URL guard: a user who reaches a tab they lack — a hand-typed URL,
  // or the default /dashboard for a tagged manager — is redirected to their first
  // allowed tab. Loop-safe because landingPath() always returns an allowed path.
  useEffect(() => {
    if (ready && user && !canAccess(user, pathname)) {
      router.replace(landingPath(user));
    }
  }, [ready, user, pathname, router]);

  // Hold the loading screen until access is verified AND the current path is allowed,
  // so a disallowed page's content never flashes before the redirect above fires.
  if (!ready || !user || !canAccess(user, pathname)) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-text-secondary">Verifying access…</div>
      </div>
    );
  }

  return (
    <AccessProvider value={{ user }}>
      <div className="flex h-screen w-full overflow-hidden bg-background">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0 h-full">
          <Header />
          <main className="flex-1 overflow-y-auto px-[30px] py-[26px] pb-12">{children}</main>
        </div>
      </div>
    </AccessProvider>
  );
}
