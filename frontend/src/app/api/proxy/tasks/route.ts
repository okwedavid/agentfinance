import { NextResponse } from 'next/server';
import { resolveBackendUrl } from '@/lib/serverConfig';

// Server-side proxy: lets the frontend reach the backend without exposing the
// backend to CORS/network topology issues on managed platforms.
const getBackend = async (): Promise<string | null> => {
  const url = await resolveBackendUrl();
  return url || null;
};

export async function GET() {
  try {
    const backend = await getBackend();
    if (!backend) {
      return NextResponse.json({ error: 'Backend not configured' }, { status: 502 });
    }
    const res = await fetch(`${backend}/tasks`, {
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) {
      return NextResponse.json({ error: 'Backend error', status: res.status }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    console.error('Proxy GET /tasks error:', e);
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 502 });
  }
}

export async function POST(request: Request) {
  try {
    const backend = await getBackend();
    if (!backend) {
      return NextResponse.json({ error: 'Backend not configured' }, { status: 502 });
    }
    const body = await request.json();
    // Forward auth header if present
    const authHeader = request.headers.get('authorization');
    const cookieHeader = request.headers.get('cookie');

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authHeader) headers['Authorization'] = authHeader;
    if (cookieHeader) headers['Cookie'] = cookieHeader;

    const res = await fetch(`${backend}/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    console.error('Proxy POST /tasks error:', e);
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 502 });
  }
}