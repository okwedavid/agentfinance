import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith('/analytics') || pathname.startsWith('/dashboard')) {
    const token = req.cookies.get('af_token') || req.cookies.get('token');
    if (!token) {
      const url = req.nextUrl.clone();
      url.pathname = '/auth';
      return NextResponse.redirect(url);
    }
  }
  return NextResponse.next();
}

export const config = { matcher: ['/analytics/:path*', '/dashboard/:path*'] };
