import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAdminSession } from '@alusa/admin-auth';

export const ADMIN_SESSION_COOKIE = process.env.NODE_ENV === 'production'
  ? '__Host-alusa_admin_session'
  : 'alusa.admin.session';

export async function requireAdminSession(pathname = '/') {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  const session = await getAdminSession(token);
  if (!session) {
    const loginUrl = new URL('/login', 'http://admin.local');
    loginUrl.searchParams.set('callbackUrl', pathname);
    redirect(`${loginUrl.pathname}${loginUrl.search}`);
  }
  return session;
}
