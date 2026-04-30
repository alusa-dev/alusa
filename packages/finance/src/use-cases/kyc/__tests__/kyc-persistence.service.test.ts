import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks (vi.mock factories can only reference hoisted vars) ────

const { mockUpsert, mockKycRequirementUpsert, mockKycSlotUpsert } = vi.hoisted(() => ({
  mockUpsert: vi.fn().mockResolvedValue({ id: 'proc-1' }),
  mockKycRequirementUpsert: vi.fn().mockResolvedValue({ id: 'req-1' }),
  mockKycSlotUpsert: vi.fn().mockResolvedValue({ id: 'slot-1' }),
}));

vi.mock('@alusa/database', () => ({
  prisma: {
    kycProcess: { upsert: mockUpsert },
    kycRequirement: { upsert: mockKycRequirementUpsert },
    kycSlot: { upsert: mockKycSlotUpsert },
  },
}));

import { syncKycModels, updateKycProcessStatus } from '../kyc-persistence.service';
import type { AsaasMyAccountDocumentsResponse, AsaasMyAccountStatus } from '@alusa/asaas';

const BASE_STATUS: AsaasMyAccountStatus = {
  general: 'PENDING',
  documentation: 'PENDING',
  bankAccountInfo: 'PENDING',
  commercialInfo: null,
  commercialInfoExpiration: null,
};

const BASE_DOCS: AsaasMyAccountDocumentsResponse = {
  data: [
    {
      id: 'grp-1',
      type: 'IDENTIFICATION',
      title: 'Documento de identidade',
      description: 'RG ou CNH',
      status: 'NOT_SENT',
      onboardingUrl: null,
      responsible: { name: 'João', type: 'HOLDER' },
      documents: [
        { id: 'slot-a', status: 'NOT_SENT' },
        { id: 'slot-b', status: 'NOT_SENT' },
      ],
    },
  ],
  rejectReasons: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUpsert.mockResolvedValue({ id: 'proc-1' });
  mockKycRequirementUpsert.mockResolvedValue({ id: 'req-1' });
  mockKycSlotUpsert.mockResolvedValue({ id: 'slot-1' });
});

describe('syncKycModels', () => {
  it('uperta KycProcess com status correto', async () => {
    await syncKycModels({
      asaasAccountId: 'acc-1',
      myAccountStatus: BASE_STATUS,
      documents: BASE_DOCS,
    });

    expect(mockUpsert).toHaveBeenCalledOnce();
    const call = mockUpsert.mock.calls[0][0];
    expect(call.where).toEqual({ asaasAccountId: 'acc-1' });
    expect(call.create.status).toBe('INTERNAL_UPLOADING');
    expect(call.update.status).toBe('INTERNAL_UPLOADING');
  });

  it('uperta requirements para cada grupo', async () => {
    await syncKycModels({
      asaasAccountId: 'acc-1',
      myAccountStatus: BASE_STATUS,
      documents: BASE_DOCS,
    });

    expect(mockKycRequirementUpsert).toHaveBeenCalledOnce();
    const call = mockKycRequirementUpsert.mock.calls[0][0];
    expect(call.where.processId_groupId.groupId).toBe('grp-1');
    expect(call.create.submissionMethod).toBe('INTERNAL_UPLOAD');
    expect(call.create.status).toBe('NOT_SENT');
  });

  it('uperta slots com labels corretos (frente/verso para 2 docs)', async () => {
    await syncKycModels({
      asaasAccountId: 'acc-1',
      myAccountStatus: BASE_STATUS,
      documents: BASE_DOCS,
    });

    expect(mockKycSlotUpsert).toHaveBeenCalledTimes(2);
    const call0 = mockKycSlotUpsert.mock.calls[0][0];
    const call1 = mockKycSlotUpsert.mock.calls[1][0];
    expect(call0.create.uiLabel).toBe('Frente');
    expect(call1.create.uiLabel).toBe('Verso');
  });

  it('detecta submissionMethod EXTERNAL quando onboardingUrl presente', async () => {
    const docs: AsaasMyAccountDocumentsResponse = {
      data: [
        {
          ...BASE_DOCS.data[0],
          onboardingUrl: 'https://asaas.com/onboarding/xyz',
        },
      ],
      rejectReasons: [],
    };

    await syncKycModels({
      asaasAccountId: 'acc-1',
      myAccountStatus: BASE_STATUS,
      documents: docs,
    });

    const call = mockKycRequirementUpsert.mock.calls[0][0];
    expect(call.create.submissionMethod).toBe('EXTERNAL_ONBOARDING_URL');
  });

  it('deriva APPROVED quando generalStatus é APPROVED', async () => {
    const status: AsaasMyAccountStatus = { ...BASE_STATUS, general: 'APPROVED' };

    await syncKycModels({
      asaasAccountId: 'acc-1',
      myAccountStatus: status,
      documents: BASE_DOCS,
    });

    const call = mockUpsert.mock.calls[0][0];
    expect(call.create.status).toBe('APPROVED');
  });

  it('idempotente — mesmos dados produzem mesmos argumentos', async () => {
    await syncKycModels({
      asaasAccountId: 'acc-1',
      myAccountStatus: BASE_STATUS,
      documents: BASE_DOCS,
    });

    const firstProcessCall = JSON.stringify(mockUpsert.mock.calls[0][0].create.status);

    vi.clearAllMocks();
    mockUpsert.mockResolvedValue({ id: 'proc-1' });
    mockKycRequirementUpsert.mockResolvedValue({ id: 'req-1' });
    mockKycSlotUpsert.mockResolvedValue({ id: 'slot-1' });

    await syncKycModels({
      asaasAccountId: 'acc-1',
      myAccountStatus: BASE_STATUS,
      documents: BASE_DOCS,
    });

    const secondProcessCall = JSON.stringify(mockUpsert.mock.calls[0][0].create.status);
    expect(firstProcessCall).toBe(secondProcessCall);
  });

  it('propaga webhookEventId quando fornecido', async () => {
    await syncKycModels({
      asaasAccountId: 'acc-1',
      myAccountStatus: BASE_STATUS,
      documents: BASE_DOCS,
      webhookEventId: 'evt-123',
    });

    const call = mockUpsert.mock.calls[0][0];
    expect(call.create.lastWebhookEventId).toBe('evt-123');
    expect(call.update.lastWebhookEventId).toBe('evt-123');
  });
});

describe('updateKycProcessStatus', () => {
  it('uperta processo apenas com status', async () => {
    await updateKycProcessStatus({
      asaasAccountId: 'acc-1',
      status: 'APPROVED',
    });

    expect(mockUpsert).toHaveBeenCalledOnce();
    const call = mockUpsert.mock.calls[0][0];
    expect(call.where).toEqual({ asaasAccountId: 'acc-1' });
    expect(call.create.status).toBe('APPROVED');
    expect(call.update.status).toBe('APPROVED');
  });

  it('inclui rejectReasons quando fornecido', async () => {
    await updateKycProcessStatus({
      asaasAccountId: 'acc-1',
      status: 'REJECTED',
      rejectReasons: ['Documento ilegível'],
    });

    const call = mockUpsert.mock.calls[0][0];
    expect(call.create.rejectReasons).toEqual(['Documento ilegível']);
    expect(call.update.rejectReasons).toEqual(['Documento ilegível']);
  });

  it('inclui webhookEventId quando fornecido', async () => {
    await updateKycProcessStatus({
      asaasAccountId: 'acc-1',
      status: 'UNDER_REVIEW',
      webhookEventId: 'evt-456',
    });

    const call = mockUpsert.mock.calls[0][0];
    expect(call.create.lastWebhookEventId).toBe('evt-456');
    expect(call.update.lastWebhookEventId).toBe('evt-456');
  });
});
