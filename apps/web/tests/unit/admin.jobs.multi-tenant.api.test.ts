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
  reconcileWithAsaas: vi.fn(),
  reconcileAsaasAccountsJob: vi.fn(),
  processAsaasWebhookQueue: vi.fn(),
  archiveProcessedWebhooks: vi.fn(),
  syncPaymentStateFromAsaas: vi.fn(),
}));

vi.mock('@alusa/lib', () => ({
  encerrarContratosExpirados: vi.fn(),
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
  reconcileWithAsaas,
  syncPaymentStateFromAsaas,
} from '@alusa/finance';
import { encerrarContratosExpirados } from '@alusa/lib';

import { POST as postArchiveWebhooks } from '@/app/api/jobs/archive-finance-webhooks/route';
import { POST as postEncerrarContratos } from '@/app/api/jobs/encerrar-contratos/route';
import { POST as postProcessWebhooks } from '@/app/api/jobs/process-finance-webhooks/route';
import { POST as postReconcileAccounts } from '@/app/api/jobs/reconcile-finance-accounts/route';
import { POST as postReconcileWebhooks } from '@/app/api/jobs/reconcile-finance-webhooks/route';

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
    vi.mocked(detectWebhookGaps).mockResolvedValue(null as never);
    vi.mocked(reconcileAsaasAccountsJob).mockResolvedValue({ processed: 1 } as never);
    vi.mocked(processAsaasWebhookQueue).mockResolvedValue({ processed: 1 } as never);
    vi.mocked(archiveProcessedWebhooks).mockResolvedValue({ archived: 1 } as never);
    vi.mocked(syncPaymentStateFromAsaas).mockResolvedValue({ success: true, paymentStatus: 'CONFIRMED', appliedEvent: 'PAYMENT_CONFIRMED' } as never);
    vi.mocked(encerrarContratosExpirados).mockResolvedValue({ processed: 1, updated: 1 } as never);
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
    expect(reconcileWithAsaas).toHaveBeenCalledWith({
      contaId: 'conta-2',
      windowHours: 24,
      limit: 200,
      dryRun: false,
    });
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

  it('exige contaId no cron de encerrar-contratos', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);

    const response = await postEncerrarContratos(
      makeRequest('http://localhost/api/jobs/encerrar-contratos', {
        'x-cron-token': 'cron-secret',
      }),
    );

    expect(response.status).toBe(400);
    expect(encerrarContratosExpirados).not.toHaveBeenCalled();
  });
});
