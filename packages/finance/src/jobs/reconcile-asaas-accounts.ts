import { prisma } from '@alusa/database';
import type { FinancialOnboardingStatus } from '@prisma/client';

import { reconcileAsaasAccount } from '../use-cases/asaas-account/reconcile-asaas-account';

/**
 * Intervalo mínimo entre reconciliações para a mesma conta (em ms).
 * Evita burst de chamadas ao Asaas.
 */
const MIN_RECONCILE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos

/**
 * Número máximo de contas a processar por execução do job.
 */
const MAX_ACCOUNTS_PER_RUN = 50;

/**
 * Janela máxima para manter espelho local sem reconciliação explícita.
 * Mesmo contas aprovadas precisam refrescar commercial info / status oficial.
 */
const MAX_SYNC_STALENESS_MS = 24 * 60 * 60 * 1000; // 24 horas

/**
 * Status que indicam que a conta pode precisar de reconciliação.
 */
const RECONCILABLE_STATUSES: FinancialOnboardingStatus[] = ['UNDER_REVIEW', 'CREATED', 'IN_PROGRESS'];

const RECONCILABLE_COMMERCIAL_INFO_STATUSES = ['EXPIRING_SOON', 'EXPIRED'] as const;

export interface ReconcileJobResult {
  processadas: number;
  reconciliadas: number;
  skippedThrottle: number;
  erros: Array<{ contaId: string; erro: string }>;
  dataExecucao: Date;
}

/**
 * Job que reconcilia periodicamente o status das subcontas Asaas.
 *
 * Responsabilidades:
 * 1. Busca contas com AsaasAccount.status em estados de "aguardando"
 * 2. Respeita throttle por conta (não reconcilia se statusUpdatedAt é recente)
 * 3. Chama reconcileAsaasAccount para sincronizar com Asaas
 * 4. Loga métricas e erros
 *
 * Pode ser invocado via cron (ex: a cada 5 minutos) ou manualmente.
 */
export async function reconcileAsaasAccountsJob(params?: {
  contaId?: string;
  forceReconcile?: boolean;
}): Promise<ReconcileJobResult> {
  const result: ReconcileJobResult = {
    processadas: 0,
    reconciliadas: 0,
    skippedThrottle: 0,
    erros: [],
    dataExecucao: new Date(),
  };

  const now = Date.now();
  const throttleThreshold = new Date(now - MIN_RECONCILE_INTERVAL_MS);
  const staleSyncThreshold = new Date(now - MAX_SYNC_STALENESS_MS);

  // Buscar contas que podem precisar de reconciliação
  const accounts = await prisma.asaasAccount.findMany({
    where: {
      asaasAccountId: { not: null },
      ...(params?.contaId
        ? { financeProfile: { contaId: params.contaId } }
        : {}),
      OR: [
        { status: { in: RECONCILABLE_STATUSES } },
        { commercialInfoStatus: { in: [...RECONCILABLE_COMMERCIAL_INFO_STATUSES] } },
        {
          financeProfile: {
            lastAsaasSyncAt: null,
          },
        },
        {
          financeProfile: {
            lastAsaasSyncAt: { lt: staleSyncThreshold },
          },
        },
      ],
      // Se não forçar, aplicar throttle
      ...(params?.forceReconcile
        ? {}
        : { statusUpdatedAt: { lt: throttleThreshold } }),
    },
    select: {
      id: true,
      status: true,
      statusUpdatedAt: true,
      asaasAccountId: true,
      commercialInfoStatus: true,
      financeProfile: {
        select: {
          contaId: true,
          lastAsaasSyncAt: true,
        },
      },
    },
    take: MAX_ACCOUNTS_PER_RUN,
    orderBy: { statusUpdatedAt: 'asc' }, // processar as mais antigas primeiro
  });

  result.processadas = accounts.length;

  console.info('[finance.reconcileJob] Iniciando reconciliação', {
    contasEncontradas: accounts.length,
    throttleThreshold: throttleThreshold.toISOString(),
    forceReconcile: params?.forceReconcile ?? false,
  });

  for (const account of accounts) {
    const contaId = account.financeProfile.contaId;

    // Double-check de throttle (para evitar race conditions)
    if (!params?.forceReconcile) {
      const ageMs = now - account.statusUpdatedAt.getTime();
      if (ageMs < MIN_RECONCILE_INTERVAL_MS) {
        result.skippedThrottle++;
        continue;
      }
    }

    try {
      const reconciled = await reconcileAsaasAccount({
        contaId,
        reason: 'scheduled_job',
        actor: { type: 'SYSTEM' },
      });

      if (reconciled.reconciled) {
        result.reconciliadas++;

        console.info('[finance.reconcileJob] Conta reconciliada', {
          contaId,
          asaasAccountId: account.asaasAccountId,
          previousStatus: reconciled.previousStatus,
          updatedStatus: reconciled.updatedStatus,
          previousCommercialInfoStatus: reconciled.previousCommercialInfoStatus,
          updatedCommercialInfoStatus: reconciled.updatedCommercialInfoStatus,
        });
      }
    } catch (error) {
      result.erros.push({
        contaId,
        erro: error instanceof Error ? error.message : String(error),
      });

      console.warn('[finance.reconcileJob] Erro ao reconciliar conta', {
        contaId,
        asaasAccountId: account.asaasAccountId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.info('[finance.reconcileJob] Reconciliação concluída', {
    processadas: result.processadas,
    reconciliadas: result.reconciliadas,
    skippedThrottle: result.skippedThrottle,
    erros: result.erros.length,
  });

  return result;
}

/**
 * Verifica se uma conta específica deve ser reconciliada agora.
 * Útil para decidir se o hub da UI deve disparar reconciliação.
 */
export async function shouldReconcileNow(contaId: string): Promise<{
  should: boolean;
  reason: string;
  retryAfterMs?: number;
}> {
  const account = await prisma.asaasAccount.findFirst({
    where: {
      financeProfile: { contaId },
      asaasAccountId: { not: null },
    },
    select: {
      status: true,
      statusUpdatedAt: true,
      commercialInfoStatus: true,
      financeProfile: {
        select: {
          lastAsaasSyncAt: true,
        },
      },
    },
  });

  if (!account) {
    return { should: false, reason: 'no_account' };
  }

  const commercialInfoNeedsReconcile =
    account.commercialInfoStatus !== null &&
    RECONCILABLE_COMMERCIAL_INFO_STATUSES.includes(account.commercialInfoStatus);

  const syncIsStale =
    account.financeProfile.lastAsaasSyncAt === null ||
    Date.now() - account.financeProfile.lastAsaasSyncAt.getTime() >= MAX_SYNC_STALENESS_MS;

  if (!RECONCILABLE_STATUSES.includes(account.status) && !commercialInfoNeedsReconcile && !syncIsStale) {
    return { should: false, reason: `status_${account.status.toLowerCase()}` };
  }

  const ageMs = Date.now() - account.statusUpdatedAt.getTime();
  if (ageMs < MIN_RECONCILE_INTERVAL_MS) {
    return {
      should: false,
      reason: 'throttled',
      retryAfterMs: MIN_RECONCILE_INTERVAL_MS - ageMs,
    };
  }

  return { should: true, reason: 'ready' };
}
