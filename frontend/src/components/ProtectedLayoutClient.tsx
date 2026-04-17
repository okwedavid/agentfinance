"use client";
import { useAuth } from '@/context/AuthContext';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function ProtectedLayoutClient({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return; // wait until auth check is done
    if (!user && pathname !== '/login') {
      router.replace('/login');
    } else if (user && pathname === '/login') {
      router.replace('/dashboard');
    }
  }, [user, loading, pathname, router]);

  if (loading) return null; // or a spinner
  if (!user && pathname !== '/login') return null;
  return <>{children}</>;
}