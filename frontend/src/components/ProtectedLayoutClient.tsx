"use client";
import { useAuth } from '@/context/AuthContext';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

const PUBLIC_PATHS = ['/login', '/register', '/auth'];

export default function ProtectedLayoutClient({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const isPublic = PUBLIC_PATHS.some(p => pathname.startsWith(p));

  useEffect(() => {
    if (loading) return;
    if (!user && !isPublic) {
      router.replace('/login');
    }
    // Don't redirect authenticated users away from public pages —
    // let them navigate manually (avoids loops)
  }, [user, loading, isPublic, router]);

  // Show nothing while checking auth
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Block protected pages for unauthenticated users
  if (!user && !isPublic) return null;

  return <>{children}</>;
}