import { NextResponse } from 'next/server';
import { resolveBackendUrl } from '@/lib/serverConfig';

export async function GET() {
  const backend = await resolveBackendUrl();

  if (!backend) {
    return NextResponse.json(
      { ok: false, frontend: 'ok', error: 'Backend URL not configured (set API_URL or NEXT_PUBLIC_API_URL)' },
      { status: 200 },
    );
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(`${backend}/health`, {
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