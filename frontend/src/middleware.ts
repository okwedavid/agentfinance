import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Middleware kept as a no-op to avoid server-side redirects which caused
// blinking behaviour. All auth/redirect logic is handled client-side in
// the dashboard and login components (per project requirements).
export function middleware(req: NextRequest) {
  return NextResponse.next();
}

export const config = { matcher: [] };
