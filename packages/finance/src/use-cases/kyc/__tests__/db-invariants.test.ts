import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ────────────────────────────────────────────────────────

const { mockKycProcessUpsert, mockKycRequirementUpsert, mockKycSlotUpsert } = vi.hoisted(() => ({
  mockKycProcessUpsert: vi.fn().mockResolvedValue({ id: 'proc-1' }),
  mockKycRequirementUpsert: vi.fn().mockResolvedValue({ id: 'req-1' }),
  mockKycSlotUpsert: vi.fn().mockResolvedValue({ id: 'slot-1' }),
}));

vi.mock('@alusa/database', () => ({
  prisma: {
    kycProcess: { upsert: mockKycProcessUpsert },
    kycRequirement: { upsert: mockKycRequirementUpsert },
    kycSlot: { upsert: mockKycSlotUpsert },
  },
}));

import { syncKycModels } from '../kyc-persistence.service';

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('syncKycModels — DB invariants', () => {
  it('corrige ZERO_UUID group status de NOT_SENT para APPROVED quando processo é APPROVED', async () => {
    await syncKycModels({
      asaasAccountId: 'acc-1',
      myAccountStatus: {
        general: 'APPROVED',
        documentation: 'APPROVED',
        bankAccountInfo: 'APPROVED',
        commercialInfo: 'APPROVED',
      },
      documents: {
        data: [
          {
            id: ZERO_UUID,
            status: 'NOT_SENT',
            type: 'IDENTIFICATION',
            title: 'Identificação',
            onboardingUrl: null,
            documents: [
              { id: ZERO_UUID, status: 'NOT_SENT', type: 'IDENTIFICATION' },
            ],
          } as never,
        ],
        rejectReasons: null,
      },
    });

    // KycRequirement should get APPROVED instead of NOT_SENT
    const reqCall = mockKycRequirementUpsert.mock.calls[0][0];
    expect(reqCall.create.status).toBe('APPROVED');
    expect(reqCall.update.status).toBe('APPROVED');

    // KycSlot should get APPROVED instead of NOT_SENT
    const slotCall = mockKycSlotUpsert.mock.calls[0][0];
    expect(slotCall.create.status).toBe('APPROVED');
    expect(slotCall.update.status).toBe('APPROVED');
  });

  it('NÃO corrige status quando UUID é real (não ZERO_UUID)', async () => {
    await syncKycModels({
      asaasAccountId: 'acc-1',
      myAccountStatus: {
        general: 'APPROVED',
        documentation: 'APPROVED',
        bankAccountInfo: 'APPROVED',
        commercialInfo: 'APPROVED',
      },
      documents: {
        data: [
          {
            id: 'real-uuid-123',
            status: 'NOT_SENT',
            type: 'IDENTIFICATION',
            title: 'Identificação',
            onboardingUrl: null,
            documents: [
              { id: 'slot-real-uuid', status: 'NOT_SENT', type: 'IDENTIFICATION' },
            ],
          } as never,
        ],
        rejectReasons: null,
      },
    });

    // Deve manter NOT_SENT quando o UUID é real
    const reqCall = mockKycRequirementUpsert.mock.calls[0][0];
    expect(reqCall.create.status).toBe('NOT_SENT');

    const slotCall = mockKycSlotUpsert.mock.calls[0][0];
    expect(slotCall.create.status).toBe('NOT_SENT');
  });

  it('NÃO corrige ZERO_UUID quando processo NÃO é terminal', async () => {
    await syncKycModels({
      asaasAccountId: 'acc-1',
      myAccountStatus: {
        general: 'PENDING',
        documentation: 'PENDING',
        bankAccountInfo: 'PENDING',
        commercialInfo: null,
      },
      documents: {
        data: [
          {
            id: ZERO_UUID,
            status: 'NOT_SENT',
            type: 'IDENTIFICATION',
            title: 'Identificação',
            onboardingUrl: null,
            documents: [
              { id: ZERO_UUID, status: 'NOT_SENT', type: 'IDENTIFICATION' },
            ],
          } as never,
        ],
        rejectReasons: null,
      },
    });

    // Deve manter NOT_SENT quando processo é PENDING
    const reqCall = mockKycRequirementUpsert.mock.calls[0][0];
    expect(reqCall.create.status).toBe('NOT_SENT');

    const slotCall = mockKycSlotUpsert.mock.calls[0][0];
    expect(slotCall.create.status).toBe('NOT_SENT');
  });

  it('corrige ZERO_UUID group status para REJECTED quando processo é REJECTED', async () => {
    await syncKycModels({
      asaasAccountId: 'acc-1',
      myAccountStatus: {
        general: 'REJECTED',
        documentation: 'REJECTED',
        bankAccountInfo: 'PENDING',
        commercialInfo: null,
      },
      documents: {
        data: [
          {
            id: ZERO_UUID,
            status: 'NOT_SENT',
            type: 'IDENTIFICATION',
            title: 'Identificação',
            onboardingUrl: null,
            documents: [],
          } as never,
        ],
        rejectReasons: ['Documento ilegível'],
      },
    });

    const reqCall = mockKycRequirementUpsert.mock.calls[0][0];
    expect(reqCall.create.status).toBe('REJECTED');
    expect(reqCall.update.status).toBe('REJECTED');
  });
});
