'use client';
import { useEffect, useState } from 'react';

async function probeUrl(url: string, timeout = 3000) {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    if (!res.ok) return false;
    // ensure JSON parseable
    try {
      await res.json();
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

export default function ApiHeartbeat() {
  const [ok, setOk] = useState(false);

  useEffect(() => {
    let mounted = true;

    const buildCandidates = () => {
      const c: string[] = [];
      if (typeof window !== 'undefined') {
        const proto = window.location.protocol;
        if (process.env.NEXT_PUBLIC_API_URL)
          c.push(process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, ''));
        // Common host fallbacks that are reachable from a browser on the host machine
        c.push(`${proto}//localhost:4000`);
        c.push(`${proto}//127.0.0.1:4000`);
        // If user opened the UI via a LAN IP, try that host as well
        c.push(`${proto}//${window.location.hostname}:4000`);
      } else {
        if (process.env.NEXT_PUBLIC_API_URL)
          c.push(process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, ''));
        c.push('http://backend:4000');
      }
      // Deduplicate while preserving order
      return Array.from(new Set(c));
    };

    const check = async () => {
      // Try same-origin proxy first
  if (await probeUrl(`${process.env.NEXT_PUBLIC_API_URL}/health`, 2000)) {
        if (mounted) setOk(true);
        return;
      }
      const candidates = buildCandidates();
      for (const base of candidates) {
        const url = `${base.replace(/\/$/, '')}/health`;
        if (await probeUrl(url, 2500)) {
          if (!mounted) return;
          setOk(true);
          return;
        }
      }
      if (mounted) setOk(false);
    };

    check();
    const iv = setInterval(check, 5000);
    return () => {
      mounted = false;
      clearInterval(iv);
    };
  }, []);

  return (
    <div className="flex items-center gap-2 px-3 py-1 rounded text-sm">
      <div className={`w-3 h-3 rounded-full ${ok ? 'bg-green-400' : 'bg-red-500'}`} />
      <span className="text-gray-300">{ok ? 'API Online' : 'API Offline'}</span>
    </div>
  );
}
