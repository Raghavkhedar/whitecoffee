'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';

export default function Root() {
  const router = useRouter();
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, user => {
      router.replace(user ? '/dashboard' : '/login');
    });
    return unsub;
  }, [router]);
  return <div className="flex items-center justify-center h-screen"><div className="text-text-secondary">Loading…</div></div>;
}
