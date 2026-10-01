import { getServerSession } from 'next-auth';
import { auditLogService } from '@alusa/finance';

import { authOptions } from '@/lib/auth-options';
import { clearAuthCookies } from '@/lib/auth-cookies';
import { revokeUserSessions } from '@/lib/auth-service';
import { jsonNoStore } from '@/lib/http-security';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';

function hasTrustedOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');
  const expectedOrigin = new URL(req.url).origin;

  try {
    return (
      new URL(origin ?? '').origin === expectedOrigin &&
      new URL(referer ?? '').origin === expectedOrigin
    );
  } catch {
    return false;
  }
}

/** Revoga todos os JWTs do usuário autenticado e encerra o dispositivo atual. */
export async function POST(req: Request) {
  if (!hasTrustedOrigin(req)) {
    return jsonNoStore({ ok: false, error: 'Origem da requisição não permitida.' }, { status: 403 });
  }

  const session = await getServerSession(authOptions).catch(() => null);
  const userId = typeof session?.user?.id === 'string' ? session.user.id.trim() : '';

  if (!userId) {
    return jsonNoStore({ ok: false, error: 'Não autenticado.' }, { status: 401 });
  }

  try {
    const updatedCount = await revokeUserSessions(userId);
    if (updatedCount === 0) {
      return jsonNoStore({ ok: false, error: 'Usuário não encontrado.' }, { status: 404 });
    }

    const contaId = typeof session?.user?.contaId === 'string' ? session.user.contaId : null;
    if (contaId) {
      try {
        await auditLogService.record({
          contaId,
          action: 'auth.sessions_revoked',
          entity: { type: 'Usuario', id: userId },
          actor: { type: 'USER', id: userId },
          metadata: { scope: 'all_sessions', channel: 'self_service' },
        });
      } catch (error) {
        logApiOperationalEvent({
          severity: 'warn',
          eventName: 'auth.sessions.audit_failed',
          route: '/api/auth/revoke-all-sessions',
          method: 'POST',
          requestId: getRequestId(req),
          error,
        });
      }
    }

    const response = jsonNoStore({ ok: true });
    return clearAuthCookies(response, req.headers.get('cookie'));
  } catch (error) {
    logApiOperationalEvent({
      severity: 'error',
      eventName: 'auth.sessions.revoke_failed',
      route: '/api/auth/revoke-all-sessions',
      method: 'POST',
      requestId: getRequestId(req),
      error,
    });
    return jsonNoStore(
      { ok: false, error: 'Não foi possível revogar as sessões.' },
      { status: 503 },
    );
  }
}
