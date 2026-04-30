import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { getKycSummary, getKycSummaryFresh } from '@alusa/finance';
import { prisma } from '@alusa/database';

type SessionUser = { id?: string; role?: string; contaId?: string };

const allowedRoles = new Set(['ADMIN']);

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveAuth(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions).catch(() => null);
  return (session as { user?: SessionUser } | null)?.user ?? null;
}

type AccountStatusItem = {
  key: string;
  label: string;
  status: string;
  description: string;
};

type CommercialInfoExpirationDTO = {
  isExpired: boolean;
  scheduledDate: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pendente',
  APPROVED: 'Aprovado',
  REJECTED: 'Rejeitado',
  AWAITING_APPROVAL: 'Em análise',
};

const STATUS_DESCRIPTIONS: Record<string, Record<string, string>> = {
  commercialInfo: {
    PENDING: 'Os dados comerciais ainda não foram preenchidos completamente.',
    APPROVED: 'Dados comerciais aprovados.',
    REJECTED: 'Dados comerciais rejeitados. Verifique as informações.',
    AWAITING_APPROVAL: 'Dados comerciais em análise.',
  },
  bankAccountInfo: {
    PENDING: 'Dados bancários ainda não foram enviados.',
    APPROVED: 'Dados bancários aprovados.',
    REJECTED: 'Dados bancários rejeitados.',
    AWAITING_APPROVAL: 'Dados bancários em análise.',
  },
  documentation: {
    PENDING: 'Documentação ainda não foi enviada.',
    APPROVED: 'Documentação aprovada.',
    REJECTED: 'Documentação rejeitada. Reenvie os documentos.',
    AWAITING_APPROVAL: 'Documentação em análise.',
  },
  general: {
    PENDING: 'Aprovação geral pendente.',
    APPROVED: 'Conta aprovada.',
    REJECTED: 'Conta reprovada.',
    AWAITING_APPROVAL: 'Conta em análise.',
  },
};

function buildStatusItem(key: string, label: string, value: string | null | undefined): AccountStatusItem {
  const normalizedStatus = (value ?? 'PENDING').toUpperCase();
  return {
    key,
    label,
    status: normalizedStatus,
    description: STATUS_DESCRIPTIONS[key]?.[normalizedStatus] ?? '',
  };
}

/**
 * GET /api/finance/account-status
 * 
 * Retorna a situação cadastral da conta no Asaas.
 * Query params:
 *   - fresh?: "1" — força refresh do cache
 */
export async function GET(req: Request) {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const url = new URL(req.url);
    const fresh = url.searchParams.get('fresh') === '1';

    const summary = fresh
      ? await getKycSummaryFresh(user.contaId)
      : await getKycSummary(user.contaId);

    const myAccountStatus = summary.myAccountStatus ?? {};
    const commercialInfoExpiration = (() => {
      const expiration = myAccountStatus.commercialInfoExpiration;
      if (!expiration) return null;
      return {
        isExpired: expiration.isExpired === true,
        scheduledDate: typeof expiration.scheduledDate === 'string' ? expiration.scheduledDate : null,
      } satisfies CommercialInfoExpirationDTO;
    })();

    // Buscar commercialInfoStatus do banco (track independente via webhook)
    const asaasAccount = await prisma.asaasAccount.findFirst({
      where: { financeProfile: { contaId: user.contaId } },
      select: { commercialInfoStatus: true, commercialInfoScheduledDate: true },
    });

    const derivedCommercialInfoStatus = commercialInfoExpiration?.isExpired === true
      ? 'EXPIRED'
      : commercialInfoExpiration?.scheduledDate
        ? 'EXPIRING_SOON'
        : asaasAccount?.commercialInfoStatus ?? null;
    const derivedCommercialInfoScheduledDate =
      commercialInfoExpiration?.scheduledDate ?? asaasAccount?.commercialInfoScheduledDate ?? null;

    const items: AccountStatusItem[] = [
      buildStatusItem('commercialInfo', 'Dados comerciais', myAccountStatus.commercialInfo),
      buildStatusItem('bankAccountInfo', 'Conta bancária', myAccountStatus.bankAccountInfo),
      buildStatusItem('documentation', 'Documentação', myAccountStatus.documentation),
      buildStatusItem('general', 'Aprovação geral', myAccountStatus.general),
    ];

    const isFullyApproved = items.every((item) => item.status === 'APPROVED');
    const hasRejection = items.some((item) => item.status === 'REJECTED');
    const hasPending = items.some((item) => item.status === 'PENDING' || item.status === 'AWAITING_APPROVAL');

    // commercialInfo expirado rebaixa overallStatus mesmo que 4 áreas estejam APPROVED
    const hasExpiredCommercialInfo =
      commercialInfoExpiration?.isExpired === true || asaasAccount?.commercialInfoStatus === 'EXPIRED';

    let overallStatus: 'APPROVED' | 'REJECTED' | 'PENDING' | 'IN_PROGRESS' | 'COMMERCIAL_INFO_EXPIRED' = 'IN_PROGRESS';
    if (isFullyApproved && hasExpiredCommercialInfo) overallStatus = 'COMMERCIAL_INFO_EXPIRED';
    else if (isFullyApproved) overallStatus = 'APPROVED';
    else if (hasRejection) overallStatus = 'REJECTED';
    else if (hasPending) overallStatus = 'PENDING';

    return json(200, {
      data: {
        items,
        overallStatus,
        commercialInfoStatus: derivedCommercialInfoStatus,
        commercialInfoScheduledDate: derivedCommercialInfoScheduledDate,
        commercialInfoExpiration,
        statusLabels: STATUS_LABELS,
        lastCheckedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('[Finance Account Status][GET]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
