import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';
import { ipFromRequest, rateLimitAsync } from '@/lib/rate-limit';
import { resolveUserId } from '../helpers';
import { simpleSuccessResultDTOSchema } from '@/features/users/dtos/index';
import { changePasswordInputDTOSchema } from '@/features/users/dtos/password';
import { auditLogService } from '@alusa/finance';
import { comparePassword, hashPassword } from '@/lib/auth-password';

function isSameOriginRequest(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;

  const configuredOrigin = process.env.NEXTAUTH_URL?.replace(/\/$/, '');
  if (configuredOrigin && origin === configuredOrigin) return true;

  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'http';
  const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || req.headers.get('host') || new URL(req.url).host;
  return Boolean(host && origin === `${forwardedProto}://${host}`);
}

async function recordPasswordAudit(params: {
  contaId: string;
  userId: string;
  action: string;
  ip: string;
  userAgent: string | null;
  result: 'success' | 'invalid_current_password';
}) {
  try {
    await auditLogService.record({
      contaId: params.contaId,
      action: params.action,
      entity: { type: 'Usuario', id: params.userId },
      actor: { type: 'USER', id: params.userId },
      metadata: {
        result: params.result,
        ip: params.ip,
        userAgent: params.userAgent,
      },
    });
  } catch (error) {
    console.error('[auth][password][audit-failed]', {
      userId: params.userId,
      action: params.action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function PATCH(req: Request) {
  try {
    if (!isSameOriginRequest(req)) {
      return NextResponse.json({ error: 'Origem inválida' }, { status: 403 });
    }

    const session = await getServerSession(authOptions);
    const userId = await resolveUserId(session?.user?.id);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ip = ipFromRequest(req);
    const limiter = await rateLimitAsync(`account:password:${userId}:${ip}`, 10, 10 * 60 * 1000);
    if (!limiter.ok) {
      return NextResponse.json({ error: 'Muitas tentativas. Aguarde alguns minutos.' }, { status: 429 });
    }

    const parsed = changePasswordInputDTOSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
    }

    const user = await prisma.usuario.findUnique({
      where: { id: userId },
      select: { senhaHash: true, contaId: true },
    });

    if (!user?.senhaHash) {
      return NextResponse.json({ error: 'Usuario nao encontrado' }, { status: 404 });
    }

    const isValid = await comparePassword(parsed.data.currentPassword, user.senhaHash);
    if (!isValid) {
      await recordPasswordAudit({
        contaId: user.contaId,
        userId,
        action: 'auth.password_change_failed',
        ip,
        userAgent: req.headers.get('user-agent'),
        result: 'invalid_current_password',
      });
      return NextResponse.json(
        { error: { fieldErrors: { currentPassword: ['Senha atual incorreta'] } } },
        { status: 403 },
      );
    }

    const newHash = await hashPassword(parsed.data.newPassword);

    await prisma.usuario.update({
      where: { id: userId },
      data: { senhaHash: newHash, passwordChangedAt: new Date() },
    });

    await recordPasswordAudit({
      contaId: user.contaId,
      userId,
      action: 'auth.password_changed',
      ip,
      userAgent: req.headers.get('user-agent'),
      result: 'success',
    });

    return NextResponse.json(simpleSuccessResultDTOSchema.parse({ success: true }));
  } catch (error) {
    console.error('Error updating password:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
