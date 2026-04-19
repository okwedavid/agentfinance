import { NextResponse } from 'next/server';

// This proxy route ensures the frontend can reach the backend
// regardless of CORS or network topology on Railway
const BACKEND = (process.env.NEXT_PUBLIC_API_URL || 'https://serene-magic-production-6d0c.up.railway.app').replace(/\/$/, '');

export async function GET() {
  try {
    const res = await fetch(`${BACKEND}/tasks`, {
      headers: { 'Content-Type': 'application/json' },
      // Don't cache - always fresh data
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
    const body = await request.json();
    // Forward auth header if present
    const authHeader = request.headers.get('authorization');
    const cookieHeader = request.headers.get('cookie');
    
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authHeader) headers['Authorization'] = authHeader;
    if (cookieHeader) headers['Cookie'] = cookieHeader;

    const res = await fetch(`${BACKEND}/tasks`, {
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