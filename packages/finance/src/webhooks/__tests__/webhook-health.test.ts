import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ────────────────────────────────────────────────────────

const { mockFindMany, mockListWebhooks, mockRemoveBackoff, mockAuditRecord, mockLoadCreds } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockListWebhooks: vi.fn(),
  mockRemoveBackoff: vi.fn(),
  mockAuditRecord: vi.fn().mockResolvedValue(undefined),
  mockLoadCreds: vi.fn(),
}));

vi.mock('@alusa/database', () => ({
  prisma: {
    asaasAccount: { findMany: mockFindMany, findFirst: vi.fn() },
  },
  loadAsaasCredentials: mockLoadCreds,
}));

vi.mock('@alusa/asaas', () => ({
  AsaasHttpError: class AsaasHttpError extends Error {
    constructor(public status: number, message = 'Asaas error') {
      super(message);
    }
  },
  listWebhooks: mockListWebhooks,
  removeWebhookBackoff: mockRemoveBackoff,
}));

vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: { record: mockAuditRecord },
}));

import { checkWebhookHealth } from '../webhook-health.service';

beforeEach(() => {
  vi.clearAllMocks();

  mockLoadCreds.mockResolvedValue({
    apiKey: 'sandbox_key',
    apiKeyStatus: 'CONNECTED',
    source: 'asaasCredentialRef' as const,
  });
});

describe('checkWebhookHealth', () => {
  it('retorna resultado limpo quando nenhum webhook está interrompido', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'acc-1',
        asaasAccountId: 'ext-acc-1',
        financeProfile: { contaId: 'conta-1' },
      },
    ]);

    mockListWebhooks.mockResolvedValue({
      data: [
        { id: 'wh-1', url: 'https://example.com', enabled: true, interrupted: false },
      ],
    });

    const result = await checkWebhookHealth();

    expect(result.checkedAccounts).toBe(1);
    expect(result.interruptedFound).toBe(0);
    expect(result.recoveredSuccessfully).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('detecta webhook interrompido e tenta recovery', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'acc-1',
        asaasAccountId: 'ext-acc-1',
        financeProfile: { contaId: 'conta-1' },
      },
    ]);

    mockListWebhooks
      .mockResolvedValueOnce({
        data: [{ id: 'wh-1', url: 'https://example.com', enabled: true, interrupted: true }],
      })
      .mockResolvedValueOnce({
        data: [{ id: 'wh-1', url: 'https://example.com', enabled: true, interrupted: false }],
      });

    mockRemoveBackoff.mockResolvedValue({
      id: 'wh-1',
      url: 'https://example.com',
      enabled: true,
      interrupted: false,
    });

    const result = await checkWebhookHealth();

    expect(result.interruptedFound).toBe(1);
    expect(result.recoveredSuccessfully).toBe(1);
    expect(result.recoveryFailed).toBe(0);
    expect(mockRemoveBackoff).toHaveBeenCalledWith({
      apiKey: 'sandbox_key',
      webhookId: 'wh-1',
    });
    expect(mockAuditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'finance.webhook.backoff_removed',
        metadata: expect.objectContaining({ recovered: true }),
      }),
    );
  });

  it('reporta falha quando removeBackoff não resolve interrupted', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'acc-1',
        asaasAccountId: 'ext-acc-1',
        financeProfile: { contaId: 'conta-1' },
      },
    ]);

    mockListWebhooks.mockResolvedValue({
      data: [{ id: 'wh-1', url: 'https://example.com', enabled: true, interrupted: true }],
    });

    mockRemoveBackoff.mockResolvedValue({
      id: 'wh-1',
      url: 'https://example.com',
      enabled: true,
      interrupted: true,
    });

    const result = await checkWebhookHealth();

    expect(result.interruptedFound).toBe(1);
    expect(result.recoveryFailed).toBe(1);
    expect(result.recoveredSuccessfully).toBe(0);
  });

  it('não tenta recovery quando autoRecover=false', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'acc-1',
        asaasAccountId: 'ext-acc-1',
        financeProfile: { contaId: 'conta-1' },
      },
    ]);

    mockListWebhooks.mockResolvedValue({
      data: [{ id: 'wh-1', url: 'https://example.com', enabled: true, interrupted: true }],
    });

    const result = await checkWebhookHealth({ autoRecover: false });

    expect(result.interruptedFound).toBe(1);
    expect(result.recoveredSuccessfully).toBe(0);
    expect(mockRemoveBackoff).not.toHaveBeenCalled();
  });

  it('é fail-safe quando loadAsaasCredentials retorna null', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'acc-1',
        asaasAccountId: 'ext-acc-1',
        financeProfile: { contaId: 'conta-1' },
      },
    ]);

    mockLoadCreds.mockResolvedValue(null);

    const result = await checkWebhookHealth();

    expect(result.checkedAccounts).toBe(1);
    expect(result.interruptedFound).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('é fail-safe quando listWebhooks falha', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'acc-1',
        asaasAccountId: 'ext-acc-1',
        financeProfile: { contaId: 'conta-1' },
      },
    ]);

    mockListWebhooks.mockRejectedValue(new Error('API timeout'));

    const result = await checkWebhookHealth();

    expect(result.checkedAccounts).toBe(1);
    expect(result.interruptedFound).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain('API timeout');
  });
});
