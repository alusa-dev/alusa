/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

vi.mock('@alusa/finance', () => ({
  detectWebhookGaps: vi.fn(),
  reconcileFinanceWebhooksJob: vi.fn(),
  reconcileWithAsaas: vi.fn(),
  reconcileAsaasAccountsJob: vi.fn(),
  processAsaasWebhookQueue: vi.fn(),
  runWebhookHealthAndDriftMaintenance: vi.fn(),
  archiveProcessedWebhooks: vi.fn(),
  syncPaymentStateFromAsaas: vi.fn(),
}));

vi.mock('@alusa/lib', () => ({
  encerrarContratosExpirados: vi.fn(),
}));

vi.mock('@/src/prisma', () => ({
  prisma: {
    matricula: { findMany: vi.fn() },
    matriculaOperacao: { findMany: vi.fn() },
  },
}));

vi.mock('@/src/server/matriculas/matricula-sync.service', () => ({
  reconcilePendingMatriculaCancellations: vi.fn(),
}));

vi.mock('@/src/server/matriculas/enrollment-closure.service', () => ({
  finalizeExpiredFamilyEnrollments: vi.fn(async () => ({ processed: 0, updated: 0, errors: [] })),
}));

vi.mock('@/lib/notifications/emit-billing-notifications', () => ({
  emitBillingNotificationCandidate: vi.fn(),
  emitBillingNotifications: vi.fn(),
}));

import { getServerSession } from 'next-auth';
import {
  archiveProcessedWebhooks,
  detectWebhookGaps,
  processAsaasWebhookQueue,
  reconcileAsaasAccountsJob,
  reconcileFinanceWebhooksJob,
  reconcileWithAsaas,
  runWebhookHealthAndDriftMaintenance,
  syncPaymentStateFromAsaas,
} from '@alusa/finance';
import { encerrarContratosExpirados } from '@alusa/lib';
import { prisma } from '@/src/prisma';
import { reconcilePendingMatriculaCancellations } from '@/src/server/matriculas/matricula-sync.service';

import { POST as postArchiveWebhooks } from '@/app/api/jobs/archive-finance-webhooks/route';
import { POST as postEncerrarContratos } from '@/app/api/jobs/encerrar-contratos/route';
import { POST as postProcessWebhooks } from '@/app/api/jobs/process-finance-webhooks/route';
import { POST as postReconcileAccounts } from '@/app/api/jobs/reconcile-finance-accounts/route';
import { POST as postReconcileWebhooks } from '@/app/api/jobs/reconcile-finance-webhooks/route';
import { POST as postReconcileMatriculaCancellations } from '@/app/api/jobs/reconcile-matricula-cancellations/route';
import { POST as postWebhookMaintenance } from '@/app/api/jobs/webhook-maintenance/route';

function makeRequest(url: string, headers?: HeadersInit) {
  return new Request(url, {
    method: 'POST',
    headers,
  });
}

describe('admin jobs multi-tenant isolation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, CRON_SECRET_TOKEN: 'cron-secret' };
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'user-1', role: 'ADMIN', contaId: 'conta-1' },
    } as never);

    vi.mocked(reconcileWithAsaas).mockResolvedValue({ ok: true } as never);
    vi.mocked(reconcileFinanceWebhooksJob).mockResolvedValue({
      processedAccounts: 1,
      results: [{ contaId: 'conta-2', reconcile: { ok: true }, gaps: null }],
      errors: [],
      skippedDueToLock: false,
    } as never);
    vi.mocked(detectWebhookGaps).mockResolvedValue(null as never);
    vi.mocked(reconcileAsaasAccountsJob).mockResolvedValue({ processed: 1 } as never);
    vi.mocked(processAsaasWebhookQueue).mockResolvedValue({ processed: 1 } as never);
    vi.mocked(runWebhookHealthAndDriftMaintenance).mockResolvedValue({
      accountsChecked: 1,
      driftsFound: 0,
      driftsRepaired: 0,
      errors: [],
    } as never);
    vi.mocked(archiveProcessedWebhooks).mockResolvedValue({ archived: 1 } as never);
    vi.mocked(syncPaymentStateFromAsaas).mockResolvedValue({ success: true, paymentStatus: 'CONFIRMED', appliedEvent: 'PAYMENT_CONFIRMED' } as never);
    vi.mocked(encerrarContratosExpirados).mockResolvedValue({ processed: 1, updated: 1 } as never);
    vi.mocked(prisma.matricula.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.matriculaOperacao.findMany).mockResolvedValue([] as never);
    vi.mocked(reconcilePendingMatriculaCancellations).mockResolvedValue({
      processed: 0,
      reconciled: [],
      errors: [],
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('bloqueia reconcile-finance-webhooks para outra conta quando executado por admin humano', async () => {
    const response = await postReconcileWebhooks(
      makeRequest('http://localhost/api/jobs/reconcile-finance-webhooks?contaId=conta-2'),
    );

    expect(response.status).toBe(403);
    expect(reconcileWithAsaas).not.toHaveBeenCalled();
  });

  it('permite reconcile-finance-webhooks cross-tenant apenas via cron autenticado', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);

    const response = await postReconcileWebhooks(
      makeRequest('http://localhost/api/jobs/reconcile-finance-webhooks?contaId=conta-2', {
        'x-cron-token': 'cron-secret',
      }),
    );

    expect(response.status).toBe(200);
    expect(reconcileFinanceWebhooksJob).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-2',
      windowHours: 24,
      limit: 100,
      dryRun: false,
      includeGaps: true,
      maxAccounts: 1,
      mode: 'targeted',
      providerCheckIntervalMinutes: 360,
      maxAsaasCalls: 100,
      accountConcurrency: 2,
      maxDurationMs: 100000,
    }));
  });

  it('usa intervalo de 24h quando safety sweep não informa intervalo explícito', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);

    const response = await postReconcileWebhooks(
      makeRequest('http://localhost/api/jobs/reconcile-finance-webhooks?mode=safety_sweep', {
        'x-cron-token': 'cron-secret',
      }),
    );

    expect(response.status).toBe(200);
    expect(reconcileFinanceWebhooksJob).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'safety_sweep',
      providerCheckIntervalMinutes: 1440,
    }));
  });

  it('reconcilia um pagamento específico sem executar a reconciliação ampla', async () => {
    const response = await postReconcileWebhooks(
      makeRequest('http://localhost/api/jobs/reconcile-finance-webhooks?asaasPaymentId=pay_123'),
    );

    expect(response.status).toBe(200);
    expect(syncPaymentStateFromAsaas).toHaveBeenCalledWith({
      contaId: 'conta-1',
      asaasPaymentId: 'pay_123',
      eventName: undefined,
    });
    expect(reconcileWithAsaas).not.toHaveBeenCalled();
  });

  it('bloqueia reconcile-finance-accounts para outra conta quando executado por admin humano', async () => {
    const response = await postReconcileAccounts(
      makeRequest('http://localhost/api/jobs/reconcile-finance-accounts?contaId=conta-2'),
    );

    expect(response.status).toBe(403);
    expect(reconcileAsaasAccountsJob).not.toHaveBeenCalled();
  });

  it('bloqueia process-finance-webhooks para outra conta quando executado por admin humano', async () => {
    const response = await postProcessWebhooks(
      makeRequest('http://localhost/api/jobs/process-finance-webhooks?contaId=conta-2'),
    );

    expect(response.status).toBe(403);
    expect(processAsaasWebhookQueue).not.toHaveBeenCalled();
  });

  it('bloqueia webhook-maintenance para outra conta quando executado por admin humano', async () => {
    const response = await postWebhookMaintenance(
      makeRequest('http://localhost/api/jobs/webhook-maintenance?contaId=conta-2'),
    );

    expect(response.status).toBe(403);
    expect(runWebhookHealthAndDriftMaintenance).not.toHaveBeenCalled();
  });

  it('permite webhook-maintenance global via cron autenticado', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);

    const response = await postWebhookMaintenance(
      makeRequest('http://localhost/api/jobs/webhook-maintenance', {
        'x-cron-token': 'cron-secret',
      }),
    );

    expect(response.status).toBe(200);
    expect(runWebhookHealthAndDriftMaintenance).toHaveBeenCalledWith({
      contaId: undefined,
      autoRepair: true,
    });
  });

  it('bloqueia archive-finance-webhooks para outra conta quando executado por admin humano', async () => {
    const response = await postArchiveWebhooks(
      makeRequest('http://localhost/api/jobs/archive-finance-webhooks?contaId=conta-2'),
    );

    expect(response.status).toBe(403);
    expect(archiveProcessedWebhooks).not.toHaveBeenCalled();
  });

  it('bloqueia encerrar-contratos para outra conta quando executado por admin humano', async () => {
    const response = await postEncerrarContratos(
      makeRequest('http://localhost/api/jobs/encerrar-contratos?contaId=conta-2'),
    );

    expect(response.status).toBe(403);
    expect(encerrarContratosExpirados).not.toHaveBeenCalled();
  });

  it('percorre contas elegíveis no cron global de encerrar-contratos', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);
    vi.mocked(prisma.matricula.findMany).mockResolvedValue([
      { contaId: 'conta-1' },
      { contaId: 'conta-2' },
    ] as never);

    const response = await postEncerrarContratos(
      makeRequest('http://localhost/api/jobs/encerrar-contratos?maxAccounts=10', {
        'x-cron-token': 'cron-secret',
      }),
    );

    expect(response.status).toBe(200);
    expect(prisma.matricula.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10, distinct: ['contaId'] }),
    );
    expect(encerrarContratosExpirados).toHaveBeenNthCalledWith(1, 'conta-1');
    expect(encerrarContratosExpirados).toHaveBeenNthCalledWith(2, 'conta-2');
  });

  it('isola falha de uma conta e continua as demais no cron global', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);
    vi.mocked(prisma.matricula.findMany).mockResolvedValue([
      { contaId: 'conta-1' },
      { contaId: 'conta-2' },
    ] as never);
    vi.mocked(encerrarContratosExpirados)
      .mockRejectedValueOnce(new Error('falha tenant 1'))
      .mockResolvedValueOnce({ processados: 1, atualizados: 1, erros: [], dataExecucao: new Date() });

    const response = await postEncerrarContratos(
      makeRequest('http://localhost/api/jobs/encerrar-contratos', {
        'x-cron-token': 'cron-secret',
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(encerrarContratosExpirados).toHaveBeenCalledTimes(2);
    expect(body).toMatchObject({
      success: true,
      processedAccounts: 2,
      updatedEnrollments: 1,
      errors: [{ contaId: 'conta-1', erro: 'falha tenant 1' }],
    });
  });

  it('reconcilia cancelamentos pendentes por tenant no cron global', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);
    vi.mocked(prisma.matriculaOperacao.findMany).mockResolvedValue([
      { contaId: 'conta-1' },
      { contaId: 'conta-2' },
    ] as never);

    const response = await postReconcileMatriculaCancellations(
      makeRequest('http://localhost/api/jobs/reconcile-matricula-cancellations?maxAccounts=10&limit=20', {
        'x-cron-token': 'cron-secret',
      }),
    );

    expect(response.status).toBe(200);
    expect(reconcilePendingMatriculaCancellations).toHaveBeenNthCalledWith(1, {
      prisma,
      contaId: 'conta-1',
      limit: 20,
    });
    expect(reconcilePendingMatriculaCancellations).toHaveBeenNthCalledWith(2, {
      prisma,
      contaId: 'conta-2',
      limit: 20,
    });
  });
});
