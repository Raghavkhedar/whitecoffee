'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import Sidebar from '@/components/Sidebar';
import Header from '@/components/Header';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router  = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async user => {
      if (!user) { router.replace('/login'); return; }
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (!snap.exists() || snap.data()?.role !== 'admin') {
        await auth.signOut();
        router.replace('/login');
        return;
      }
      setReady(true);
    });
    return unsub;
  }, [router]);

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-text-secondary">Verifying access…</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 h-full">
        <Header />
        <main className="flex-1 overflow-y-auto px-[30px] py-[26px] pb-12">{children}</main>
      </div>
    </div>
  );
}
