import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SESSION_COOKIES = ['__Host-alusa_admin_session', 'alusa.admin.session'];

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname === '/login' || pathname.startsWith('/api/auth/')) return NextResponse.next();
  if (pathname.startsWith('/api/')) return NextResponse.next();
  if (pathname.startsWith('/_next/') || pathname === '/favicon.ico') return NextResponse.next();
  if (SESSION_COOKIES.some((name) => request.cookies.has(name))) return NextResponse.next();
  const login = new URL('/login', request.url);
  login.searchParams.set('callbackUrl', `${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
