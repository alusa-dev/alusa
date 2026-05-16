import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';

import { authOptions } from '@/lib/auth-options';
import { jsonNoStore } from '@/lib/http-security';

type SessionUser = {
  id?: string;
  role?: string;
  contaId?: string;
};

type ResolveTenantScopeOptions = {
  requestedContaId?: string | null;
  allowCron?: boolean;
  requireAdmin?: boolean;
  requireContaIdForCron?: boolean;
};

type TenantScopeSuccess = {
  ok: true;
  contaId?: string;
  user: SessionUser | null;
  isAdmin: boolean;
  isCron: boolean;
};

type TenantScopeFailure = {
  ok: false;
  response: NextResponse;
};

type TenantScopeResult = TenantScopeSuccess | TenantScopeFailure;

function jsonError(status: number, code: string, message: string) {
  return jsonNoStore({ error: { code, message } }, { status });
}

function normalizeContaId(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export async function resolveTenantScope(
  req: Request,
  options: ResolveTenantScopeOptions = {},
): Promise<TenantScopeResult> {
  const session = await getServerSession(authOptions).catch(() => null);
  const user = (session as { user?: SessionUser } | null)?.user ?? null;
  const requestedContaId = normalizeContaId(options.requestedContaId);

  const cronToken = options.allowCron ? req.headers.get('x-cron-token') : null;
  const authorization = options.allowCron ? req.headers.get('authorization') : null;
  const bearerToken = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null;
  const configuredCronToken = process.env.CRON_SECRET_TOKEN ?? process.env.CRON_SECRET;
  const isCron = Boolean(
    options.allowCron &&
    configuredCronToken &&
    (cronToken === configuredCronToken || bearerToken === configuredCronToken),
  );
  const isAdmin = user?.role?.toUpperCase() === 'ADMIN';

  if (isCron) {
    if (options.requireContaIdForCron && !requestedContaId) {
      return {
        ok: false,
        response: jsonError(400, 'CONTA_OBRIGATORIA', 'contaId é obrigatório.'),
      };
    }

    return {
      ok: true,
      contaId: requestedContaId,
      user,
      isAdmin,
      isCron: true,
    };
  }

  if (!user?.id || !user?.contaId) {
    return {
      ok: false,
      response: jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado.'),
    };
  }

  if (options.requireAdmin !== false && !isAdmin) {
    return {
      ok: false,
      response: jsonError(403, 'PERMISSAO_NEGADA', 'Apenas admins podem executar esta operação.'),
    };
  }

  if (requestedContaId && requestedContaId !== user.contaId) {
    return {
      ok: false,
      response: jsonError(403, 'CONTA_INVALIDA', 'Você só pode operar sua própria conta.'),
    };
  }

  return {
    ok: true,
    contaId: user.contaId,
    user,
    isAdmin,
    isCron: false,
  };
}
