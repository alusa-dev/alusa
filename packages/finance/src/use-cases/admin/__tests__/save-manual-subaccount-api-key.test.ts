import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alusa/asaas', () => ({
  getMyAccount: vi.fn(),
}));

vi.mock('../../../foundation/asaas-api-key', () => ({
  validateSubaccountApiKey: vi.fn(),
}));

vi.mock('../../../foundation/credential-vault', () => ({
  credentialVault: { encrypt: vi.fn(() => 'encrypted:manual-key') },
}));

vi.mock('../../../foundation/audit-log.service', () => ({
  auditLogService: { record: vi.fn() },
}));

vi.mock('../../../webhooks/webhook-config-drift.service', () => ({
  repairWebhookConfigDrift: vi.fn(),
}));

vi.mock('../../asaas-account/reconcile-asaas-account', () => ({
  reconcileAsaasAccount: vi.fn(),
}));

const tx = {
  asaasAccount: { update: vi.fn() },
  asaasCredential: { upsert: vi.fn() },
};

vi.mock('@alusa/database', () => ({
  prisma: {
    conta: { findUnique: vi.fn() },
    financeProfile: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { getMyAccount } from '@alusa/asaas';
import { prisma } from '@alusa/database';
import { FinanceIntegrationMode } from '@prisma/client';
import { auditLogService } from '../../../foundation/audit-log.service';
import { validateSubaccountApiKey } from '../../../foundation/asaas-api-key';
import { repairWebhookConfigDrift } from '../../../webhooks/webhook-config-drift.service';
import { reconcileAsaasAccount } from '../../asaas-account/reconcile-asaas-account';
import { saveManualSubaccountApiKey } from '../save-manual-subaccount-api-key';

const validInput = {
  contaId: 'conta-1',
  apiKey: '$aact_hmlg_manual_key',
  reason: 'reconciliar chave manual gerada',
  actor: { type: 'ADMIN' as const, id: 'ops' },
};

function mockConta(mode = FinanceIntegrationMode.WHITELABEL_BAAS) {
  vi.mocked(prisma.conta.findUnique).mockResolvedValue({
    id: 'conta-1',
    financeIntegrationMode: mode,
  } as never);
}

function mockProfile(
  overrides?: Partial<{ asaasAccountId: string | null; asaasAccount: unknown }>,
) {
  vi.mocked(prisma.financeProfile.findUnique).mockResolvedValue({
    id: 'fp-1',
    asaasAccountId:
      overrides && 'asaasAccountId' in overrides ? overrides.asaasAccountId : 'asaas-sub-1',
    asaasAccount:
      overrides && 'asaasAccount' in overrides
        ? overrides.asaasAccount
        : { id: 'aa-1', asaasAccountId: 'asaas-sub-1' },
  } as never);
}

describe('saveManualSubaccountApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.asaasAccount.update.mockResolvedValue({ id: 'aa-1' });
    tx.asaasCredential.upsert.mockResolvedValue({ id: 'cred-1' });
    vi.mocked(prisma.$transaction).mockImplementation(
      async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
    );
    vi.mocked(validateSubaccountApiKey).mockResolvedValue('CONNECTED');
    vi.mocked(getMyAccount).mockResolvedValue({ id: 'asaas-sub-1' } as never);
    vi.mocked(repairWebhookConfigDrift).mockResolvedValue({
      repaired: true,
      reason: 'REPAIRED',
      before: null,
      after: null,
    } as never);
    vi.mocked(reconcileAsaasAccount).mockResolvedValue({ reconciled: true } as never);
  });

  it('falha se conta não existe', async () => {
    vi.mocked(prisma.conta.findUnique).mockResolvedValue(null);

    const result = await saveManualSubaccountApiKey(validInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe('NO_CONTA');
  });

  it('falha se conta não é WHITELABEL_BAAS', async () => {
    mockConta(FinanceIntegrationMode.EXTERNAL_ASAAS_ACCOUNT);

    const result = await saveManualSubaccountApiKey(validInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe('NOT_WHITELABEL_BAAS');
  });

  it('falha se não existe FinanceProfile', async () => {
    mockConta();
    vi.mocked(prisma.financeProfile.findUnique).mockResolvedValue(null);

    const result = await saveManualSubaccountApiKey(validInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe('NO_FINANCE_PROFILE');
  });

  it('falha se não existe AsaasAccount', async () => {
    mockConta();
    mockProfile({ asaasAccount: null });

    const result = await saveManualSubaccountApiKey(validInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe('NO_ASAAS_ACCOUNT');
  });

  it('falha se não existe asaasAccountId vinculado', async () => {
    mockConta();
    mockProfile({ asaasAccountId: null, asaasAccount: { id: 'aa-1', asaasAccountId: null } });

    const result = await saveManualSubaccountApiKey(validInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe('NO_SUBACCOUNT_ID');
  });

  it('falha se API Key é inválida', async () => {
    mockConta();
    mockProfile();
    vi.mocked(validateSubaccountApiKey).mockResolvedValue('REVOKED');

    const result = await saveManualSubaccountApiKey(validInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe('INVALID_API_KEY');
  });

  it('falha se getMyAccount retorna conta diferente', async () => {
    mockConta();
    mockProfile();
    vi.mocked(getMyAccount).mockResolvedValue({ id: 'outra-subconta' } as never);

    const result = await saveManualSubaccountApiKey(validInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe('ACCOUNT_MISMATCH');
  });

  it('salva criptografado, faz upsert, audita sem apiKey, repara webhook e reconcilia', async () => {
    mockConta();
    mockProfile();

    const result = await saveManualSubaccountApiKey(validInput);

    expect(result.ok).toBe(true);
    expect(tx.asaasAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          apiKeyEncrypted: 'encrypted:manual-key',
          apiKeyStatus: 'CONNECTED',
          status: 'CREATED',
          provisionLastError: null,
        }),
      }),
    );
    expect(tx.asaasCredential.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { apiKeyEncrypted: 'encrypted:manual-key' },
        create: { financeProfileId: 'fp-1', apiKeyEncrypted: 'encrypted:manual-key' },
      }),
    );
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'finance.asaas.save_manual_subaccount_api_key',
        metadata: expect.not.objectContaining({ apiKey: expect.any(String) }),
      }),
    );
    expect(repairWebhookConfigDrift).toHaveBeenCalledWith({
      contaId: 'conta-1',
      actor: { type: 'ADMIN', id: 'ops' },
    });
    expect(reconcileAsaasAccount).toHaveBeenCalledWith({
      contaId: 'conta-1',
      actor: { type: 'ADMIN', id: 'ops' },
      reason: 'reconciliar chave manual gerada',
    });
  });

  it('retorna ok com warnings se webhook e reconciliação falham', async () => {
    mockConta();
    mockProfile();
    vi.mocked(repairWebhookConfigDrift).mockRejectedValue(new Error('webhook indisponível'));
    vi.mocked(reconcileAsaasAccount).mockRejectedValue(new Error('asaas indisponível'));

    const result = await saveManualSubaccountApiKey(validInput);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.map((w) => w.code)).toEqual([
        'WEBHOOK_REPAIR_FAILED',
        'RECONCILE_FAILED',
      ]);
      expect(result.reconcile.error).toBe('asaas indisponível');
    }
  });
});
