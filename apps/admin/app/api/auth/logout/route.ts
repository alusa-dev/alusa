import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { revokeAdminSession } from '@alusa/admin-auth';
import { ADMIN_SESSION_COOKIE } from '@/lib/session';

export async function POST(request: Request) {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  await revokeAdminSession(token);
  const response = NextResponse.redirect(new URL('/login', request.url));
  response.cookies.set(ADMIN_SESSION_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 });
  return response;
}
