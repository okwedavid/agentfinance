import { NextResponse } from 'next/server';

const BACKEND = (process.env.NEXT_PUBLIC_API_URL || 'https://serene-magic-production-6d0c.up.railway.app').replace(/\/$/, '');

export async function GET() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const res = await fetch(`${BACKEND}/health`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeout);
    
    const data = await res.json().catch(() => ({}));
    return NextResponse.json({ ok: res.ok, backend: data, frontend: 'ok' }, { status: 200 });
  } catch (e) {
    // Frontend is still healthy even if backend is down
    return NextResponse.json({ ok: false, frontend: 'ok', error: 'Backend unreachable' }, { status: 200 });
  }
}