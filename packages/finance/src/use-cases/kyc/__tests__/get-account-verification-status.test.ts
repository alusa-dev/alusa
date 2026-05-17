import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getAccountVerificationStatus } from '../get-account-verification-status';

const resolveProvisioningHintMock = vi.fn();

vi.mock('../subaccount-provisioning-hint', () => ({
  resolveSubaccountProvisioningHint: (contaId: string) => resolveProvisioningHintMock(contaId),
}));

const mockGetKycSnapshotByContaId = vi.fn();
const mockEnsureSubaccountEmailSynced = vi.fn();

vi.mock('../get-kyc-snapshot', () => ({
  getKycSnapshotByContaId: (...args: unknown[]) => mockGetKycSnapshotByContaId(...args),
}));

vi.mock('../../asaas-account/ensure-subaccount-email-synced', () => ({
  ensureSubaccountEmailSynced: (...args: unknown[]) => mockEnsureSubaccountEmailSynced(...args),
}));

function baseSnapshot(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    generalStatus: 'PENDING',
    documentationStatus: 'PENDING',
    bankAccountStatus: 'PENDING',
    commercialInfoAreaStatus: 'PENDING',
    processStatus: 'PENDING_DOCUMENTS',
    commercialInfoStatus: null,
    commercialInfoScheduledDate: null,
    commercialInfoExpiration: null,
    hasBlockingPending: true,
    rejectReasons: [],
    fetchedAt: new Date().toISOString(),
    nextActions: [],
    ...overrides,
  };
}

describe('getAccountVerificationStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureSubaccountEmailSynced.mockResolvedValue({ synced: false, canonicalEmail: null });
    resolveProvisioningHintMock.mockResolvedValue(null);
  });

  it('mapeia group com onboardingUrl para action REDIRECT com redirectUrl (sem uploadGroupId)', async () => {
    mockGetKycSnapshotByContaId.mockResolvedValueOnce(
      baseSnapshot({
        nextActions: [
          {
            kind: 'EXTERNAL_ONBOARDING',
            groupId: 'grp_1',
            groupStatus: 'NOT_SENT',
            type: 'IDENTIFICATION',
            title: 'RG ou CNH',
            description: 'Envie frente e verso',
            onboardingUrl: 'https://example.com/onboarding/xyz',
            onboardingUrlExpirationDate: null,
            isOnboardingUrlExpired: false,
          },
        ],
      }),
    );

    const result = await getAccountVerificationStatus('conta_1', { fresh: true });

    expect(result.ready).toBe(true);
    if (!result.ready) return;

    expect(mockEnsureSubaccountEmailSynced).toHaveBeenCalledWith({
      contaId: 'conta_1',
      actor: { type: 'SYSTEM' },
    });

    expect(result.data.actions).toHaveLength(1);
    const action = result.data.actions[0]!;

    expect(action.mode).toBe('REDIRECT');
    expect(action.redirectUrl).toBe('https://example.com/onboarding/xyz');
    expect(action.uploadGroupId).toBeUndefined();
  });

  it('mapeia group sem onboardingUrl para action UPLOAD com uploadGroupId (sem redirectUrl)', async () => {
    mockGetKycSnapshotByContaId.mockResolvedValueOnce(
      baseSnapshot({
        nextActions: [
          {
            kind: 'UPLOAD_DOCUMENT',
            groupId: 'grp_2',
            groupStatus: 'REJECTED',
            type: 'SOCIAL_CONTRACT',
            title: 'Contrato social',
            description: 'Envie o documento',
            slots: [
              { id: 'doc_1', label: 'Arquivo', status: 'REJECTED' },
            ],
          },
        ],
      }),
    );

    const result = await getAccountVerificationStatus('conta_1', { fresh: false });

    expect(result.ready).toBe(true);
    if (!result.ready) return;

    expect(mockEnsureSubaccountEmailSynced).not.toHaveBeenCalled();

    const action = result.data.actions[0]!;
    expect(action.mode).toBe('UPLOAD');
    expect(action.uploadGroupId).toBe('grp_2');
    expect(action.redirectUrl).toBeUndefined();
    expect(action.status).toBe('REJECTED');
  });

  it('mapeia etapa não enviável via API para action PROVIDER_PORTAL_REQUIRED sem uploadGroupId', async () => {
    mockGetKycSnapshotByContaId.mockResolvedValueOnce(
      baseSnapshot({
        nextActions: [
          {
            kind: 'PROVIDER_PORTAL_REQUIRED',
            groupId: 'grp_2b',
            groupStatus: 'NOT_SENT',
            type: 'IDENTIFICATION',
            title: 'Documentos de identificação',
            description: 'Esta etapa precisa ser concluída no ambiente de verificação configurado para a conta.',
          },
        ],
      }),
    );

    const result = await getAccountVerificationStatus('conta_1', { fresh: false });

    expect(result.ready).toBe(true);
    if (!result.ready) return;

    const action = result.data.actions[0]!;
    expect(action.mode).toBe('PROVIDER_PORTAL_REQUIRED');
    expect(action.uploadGroupId).toBeUndefined();
    expect(action.redirectUrl).toBeUndefined();
    expect(action.description).toContain('ambiente de verificação');
  });

  it('não degrada REDIRECT para UPLOAD quando snapshot cache não tem URL (faz refetch fresh)', async () => {
    mockGetKycSnapshotByContaId
      .mockResolvedValueOnce(
        baseSnapshot({
          nextActions: [
            {
              kind: 'EXTERNAL_ONBOARDING',
              groupId: 'grp_3',
              groupStatus: 'NOT_SENT',
              type: 'IDENTIFICATION',
              title: 'RG',
              // sem onboardingUrl (cache)
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        baseSnapshot({
          nextActions: [
            {
              kind: 'EXTERNAL_ONBOARDING',
              groupId: 'grp_3',
              groupStatus: 'NOT_SENT',
              type: 'IDENTIFICATION',
              title: 'RG',
              onboardingUrl: 'https://example.com/onboarding/abc',
              onboardingUrlExpirationDate: null,
              isOnboardingUrlExpired: false,
            },
          ],
        }),
      );

    const result = await getAccountVerificationStatus('conta_1', { fresh: false });

    expect(mockGetKycSnapshotByContaId).toHaveBeenCalledTimes(2);
    expect(mockGetKycSnapshotByContaId.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ fresh: true }));

    expect(result.ready).toBe(true);
    if (!result.ready) return;

    const action = result.data.actions[0]!;
    expect(action.mode).toBe('REDIRECT');
    expect(action.redirectUrl).toBe('https://example.com/onboarding/abc');
    expect(action.uploadGroupId).toBeUndefined();
  });

  it('propaga commercialInfoExpiration para o payload de produto', async () => {
    mockGetKycSnapshotByContaId.mockResolvedValueOnce(
      baseSnapshot({
        commercialInfoStatus: 'EXPIRING_SOON',
        commercialInfoScheduledDate: '2026-12-31',
        commercialInfoExpiration: { isExpired: false, scheduledDate: '2026-12-31' },
      }),
    );

    const result = await getAccountVerificationStatus('conta_1', { fresh: true });

    expect(result.ready).toBe(true);
    if (!result.ready) return;

    expect(result.data.commercialInfoExpiration).toEqual({
      isExpired: false,
      scheduledDate: '2026-12-31',
    });
  });

  it('quando snapshot é null, anexa subaccountProvisioning quando o resolver retorna hint', async () => {
    mockGetKycSnapshotByContaId.mockResolvedValueOnce(null);
    resolveProvisioningHintMock.mockResolvedValueOnce({
      state: 'QUEUED',
      jobStatus: 'PENDING',
      asaasAccountStatus: 'READY_FOR_PROVISIONING',
      lastError: null,
      attempts: 0,
    });

    const result = await getAccountVerificationStatus('conta_1', { fresh: false });

    expect(result.ready).toBe(false);
    if (result.ready) return;
    expect(result.subaccountProvisioning?.state).toBe('QUEUED');
    expect(resolveProvisioningHintMock).toHaveBeenCalledWith('conta_1');
  });
});
