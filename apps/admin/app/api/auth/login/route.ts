import { NextResponse } from 'next/server';
import { authenticateAdminUser, createAdminSession, supportRoleFromAdminRole } from '@alusa/admin-auth';
import { ipFromRequest, authRateLimitAsync, rateLimitSubject } from '@alusa/lib/security/rate-limit';
import { prisma } from '@alusa/database';
import { ADMIN_SESSION_COOKIE } from '@/lib/session';
import { z } from 'zod';

const loginSchema = z.object({
  username: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(512),
});

export async function POST(request: Request) {
  const ip = ipFromRequest(request);
  const ipLimit = await authRateLimitAsync(`admin:login:ip:${ip}`, 20, 10 * 60 * 1000);
  if (!ipLimit.ok) return NextResponse.json({ error: 'Muitas tentativas. Aguarde alguns minutos.' }, { status: 429, headers: { 'cache-control': 'no-store' } });
  try {
    const parsed = loginSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'Credenciais inválidas' }, { status: 401 });
    const body = parsed.data;
    const subject = await rateLimitSubject(body.username);
    const subjectLimit = await authRateLimitAsync(`admin:login:${ip}:${subject}`, 5, 10 * 60 * 1000);
    if (!subjectLimit.ok) return NextResponse.json({ error: 'Muitas tentativas. Aguarde alguns minutos.' }, { status: 429, headers: { 'cache-control': 'no-store' } });
    const user = await authenticateAdminUser({ username: body.username, password: body.password });
    if (!user) return NextResponse.json({ error: 'Credenciais inválidas' }, { status: 401, headers: { 'cache-control': 'no-store' } });
    const session = await createAdminSession({ adminUserId: user.id, ip, userAgent: request.headers.get('user-agent') });
    await prisma.supportAuditLog.create({ data: { actorId: user.id, actorUsername: user.username, actorRole: supportRoleFromAdminRole(user.role), action: 'admin.auth.login', ip, userAgent: request.headers.get('user-agent'), metadata: { authSource: 'admin_user' } } });
    const response = NextResponse.json({ success: true, user: { id: user.id, username: user.username, role: user.role, expiresAt: session.expiresAt.toISOString() } }, { headers: { 'cache-control': 'no-store' } });
    response.cookies.set(ADMIN_SESSION_COOKIE, session.token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 8 * 60 * 60 });
    return response;
  } catch {
    return NextResponse.json({ error: 'Não foi possível processar a autenticação.' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }
}
