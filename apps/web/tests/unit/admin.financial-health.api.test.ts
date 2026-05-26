import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/src/prisma', () => ({
  prisma: {
    asaasAccount: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@alusa/database', () => ({
  loadAsaasCredentials: vi.fn(),
}));

vi.mock('@alusa/finance', () => ({
  getAsaasBaseUrlFromEnvOrThrow: vi.fn(),
  getAsaasReadIntentStats: vi.fn(),
  getWebhookQueueMetrics: vi.fn(),
  getWebhookHealthStatus: vi.fn(),
  getKycAsaasReadCacheStats: vi.fn(),
  getPaymentCommandPreflightStats: vi.fn(),
  recordAsaasReadIntent: vi.fn(),
}));

import { getServerSession } from 'next-auth';
import { prisma } from '@/src/prisma';
import { getAsaasBaseUrlFromEnvOrThrow } from '@alusa/finance';
import { loadAsaasCredentials } from '@alusa/database';
import {
  getAsaasReadIntentStats,
  getKycAsaasReadCacheStats,
  getPaymentCommandPreflightStats,
  getWebhookHealthStatus,
  getWebhookQueueMetrics,
} from '@alusa/finance';

import { GET } from '@/app/api/admin/financial/health/route';

describe('GET /api/admin/financial/health', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };

    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'u1', contaId: 'c1', role: 'ADMIN' },
    });

    vi.mocked(getAsaasBaseUrlFromEnvOrThrow).mockReturnValue('https://example.invalid');
    vi.mocked(loadAsaasCredentials).mockResolvedValue({ apiKey: 'key' } as never);
    vi.mocked(getWebhookQueueMetrics).mockResolvedValue({
      contaId: 'c1',
      backlog: 0,
      pending: 0,
      processing: 0,
      errored: 0,
      processed: 10,
      highRetryBacklog: 0,
      stuckProcessing: 0,
      oldestPendingAt: null,
      lagSeconds: null,
      generatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    vi.mocked(getWebhookHealthStatus).mockResolvedValue({
      contaId: 'c1',
      asaasAccountId: 'acc_1',
      webhooks: [{ id: 'wh_1', url: 'https://example.invalid/api/webhooks/asaas', enabled: true, interrupted: false }],
      hasInterrupted: false,
    });
    vi.mocked(getKycAsaasReadCacheStats).mockReturnValue({
      status: {
        hits: 0,
        misses: 0,
        forceRefreshes: 0,
      },
      documents: {
        hits: 0,
        misses: 0,
        forceRefreshes: 0,
      },
      invalidations: 0,
    });
    vi.mocked(getPaymentCommandPreflightStats).mockReturnValue({
      statusOnly: 3,
      fullPayment: 1,
    });
    vi.mocked(getAsaasReadIntentStats).mockReturnValue({
      READ_MODEL: 4,
      COMMAND_PREFLIGHT_STATUS: 3,
      COMMAND_PREFLIGHT_FULL: 1,
      RECONCILIATION: 2,
      MANUAL_REPAIR: 1,
      AUTHORITATIVE_DOCUMENT: 1,
    });
    vi.mocked(prisma.asaasAccount.findFirst).mockResolvedValue({ webhookAuthTokenHash: 'hash' } as never);

    process.env.ASAAS_WEBHOOK_AUTH_TOKEN_SECRET = 'secret';
    process.env.FEATURE_ASAAS = 'true';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('retorna 200 e ok=true quando todos os checks passam', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json).toMatchObject({
      ok: true,
      overallStatus: 'OK',
      asaasReads: {
        kycCache: {
          status: {
            hits: 0,
            misses: 0,
            forceRefreshes: 0,
          },
        },
        commandPreflight: {
          statusOnly: 3,
          fullPayment: 1,
        },
        intentStats: {
          READ_MODEL: 4,
          COMMAND_PREFLIGHT_STATUS: 3,
          COMMAND_PREFLIGHT_FULL: 1,
          RECONCILIATION: 2,
          MANUAL_REPAIR: 1,
          AUTHORITATIVE_DOCUMENT: 1,
        },
      },
    });

    expect(json.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'base_url', ok: true }),
        expect.objectContaining({ name: 'credentials', ok: true }),
        expect.objectContaining({ name: 'webhook', ok: true }),
        expect.objectContaining({ name: 'feature_flag', ok: true }),
      ]),
    );
  });

  it('retorna 200 e ok=false quando credenciais faltam', async () => {
    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce(null as never);

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json).toMatchObject({ ok: false, overallStatus: 'ERROR' });
    expect(json.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'credentials', ok: false, message: 'MISSING' })]),
    );
  });

  it('retorna ok=false quando webhook remoto está interrompido', async () => {
    vi.mocked(getWebhookHealthStatus).mockResolvedValueOnce({
      contaId: 'c1',
      asaasAccountId: 'acc_1',
      webhooks: [{ id: 'wh_1', url: 'https://example.invalid/api/webhooks/asaas', enabled: true, interrupted: true }],
      hasInterrupted: true,
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json).toMatchObject({ ok: false, overallStatus: 'ERROR' });
    expect(json.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'webhook', ok: false, message: 'REMOTE_INTERRUPTED' })]),
    );
  });

  it('retorna 401 quando não autenticado', async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('retorna 403 quando sem permissão', async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: { id: 'u1', contaId: 'c1', role: 'PROFESSOR' },
    });

    const res = await GET();
    expect(res.status).toBe(403);
  });
});
