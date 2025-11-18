import { NextResponse } from 'next/server';

export async function GET() {
  const backend = process.env.NEXT_PUBLIC_API_URL || 'http://backend:4000';
  const url = `${backend.replace(/\/$/, '')}/health`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return NextResponse.json({ ok: true, data }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false }, { status: 502 });
  }
}
