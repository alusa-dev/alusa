import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alusa/asaas', () => ({
  createSubaccountAccessToken: vi.fn(),
  getMyAccount: vi.fn(),
  AsaasHttpError: class AsaasHttpError extends Error {
    status: number;
    response: unknown;
    constructor(message: string, status: number, response: unknown) {
      super(message);
      this.status = status;
      this.response = response;
    }
  },
}));

vi.mock('../../foundation/asaas-api-key', () => ({
  validateSubaccountApiKey: vi.fn(),
}));

vi.mock('../../webhooks/webhook-config-drift.service', () => ({
  repairWebhookConfigDrift: vi.fn(),
}));

vi.mock('../asaas-account/reconcile-asaas-account', () => ({
  reconcileAsaasAccount: vi.fn(),
}));

vi.mock('../../foundation/credential-vault', () => ({
  credentialVault: { encrypt: vi.fn(() => 'encrypted:unit-test') },
}));

vi.mock('../asaas-account/asaas-env', () => ({
  getMasterAsaasApiKey: vi.fn(() => '$aact_master_unit'),
}));

const { prisma } = await import('@alusa/database');
vi.mock('@alusa/database', () => ({
  prisma: {
    conta: { findUnique: vi.fn() },
    financeProfile: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

const { auditLogService } = await import('../../foundation/audit-log.service');
vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: { record: vi.fn() },
}));

import { createSubaccountAccessToken, getMyAccount } from '@alusa/asaas';
import { FinanceIntegrationMode } from '@prisma/client';
import { validateSubaccountApiKey } from '../../foundation/asaas-api-key';
import { repairWebhookConfigDrift } from '../../webhooks/webhook-config-drift.service';
import { reconcileAsaasAccount } from '../asaas-account/reconcile-asaas-account';
import { recoverWhitelabelBaasViaParentAccount } from '../recover-whitelabel-baas-via-parent';

describe('recoverWhitelabelBaasViaParentAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        asaasAccount: { update: vi.fn().mockResolvedValue({ id: true }) },
        asaasCredential: { upsert: vi.fn().mockResolvedValue({ id: true }) },
      }),
    );
  });

  it('rejeita quando não é white-label BaaS', async () => {
    vi.mocked(prisma.conta.findUnique).mockResolvedValue({
      financeIntegrationMode: FinanceIntegrationMode.EXTERNAL_ASAAS_ACCOUNT,
    } as never);

    const r = await recoverWhitelabelBaasViaParentAccount({
      contaId: 'c1',
      reason: 'motivo longo o suficiente',
      actor: { type: 'ADMIN', id: 'ops' },
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe('NOT_WHITELABEL_BAAS');
  });

  it('gera chave, persiste e reconcilia quando necessário', async () => {
    vi.mocked(prisma.conta.findUnique).mockResolvedValue({
      financeIntegrationMode: FinanceIntegrationMode.WHITELABEL_BAAS,
    } as never);

    vi.mocked(prisma.financeProfile.findUnique).mockResolvedValue({
      id: 'fp1',
      asaasAccountId: 'asaas-sub-1',
      asaasAccount: {
        id: 'local-aa1',
        asaasAccountId: 'asaas-sub-1',
        apiKeyEncrypted: null,
        apiKeyStatus: 'MISSING',
      },
    } as never);

    vi.mocked(createSubaccountAccessToken).mockResolvedValue({
      id: 'tok_1',
      name: 'x',
      apiKey: '$aact_sub_new',
    });

    vi.mocked(validateSubaccountApiKey).mockResolvedValue('CONNECTED');
    vi.mocked(getMyAccount).mockResolvedValue({ id: 'asaas-sub-1' } as never);

    vi.mocked(repairWebhookConfigDrift).mockResolvedValue({
      repaired: false,
      reason: 'NO_DRIFT',
      before: null,
      after: null,
    } as never);

    vi.mocked(reconcileAsaasAccount).mockResolvedValue({
      reconciled: true,
      financeProfileId: 'fp1',
      asaasAccountId: 'asaas-sub-1',
      previousStatus: 'NOT_STARTED',
      updatedStatus: 'CREATED',
      previousFinanceStatus: 'FINANCE_NOT_STARTED',
      updatedFinanceStatus: 'FINANCE_PROFILE_COMPLETED',
      previousCommercialInfoStatus: null,
      updatedCommercialInfoStatus: null,
      updatedCommercialInfoScheduledDate: null,
      myAccountStatus: null,
    } as never);

    const r = await recoverWhitelabelBaasViaParentAccount({
      contaId: 'c1',
      reason: 'recuperar após falha operacional xx',
      actor: { type: 'ADMIN', id: 'central' },
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.keyRestored).toBe(true);
      expect(r.reconcile.reconciled).toBe(true);
    }
    expect(vi.mocked(createSubaccountAccessToken)).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'asaas-sub-1' }),
    );
    expect(vi.mocked(auditLogService.record)).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'finance.asaas.support_recover_via_parent' }),
    );
  });
});
