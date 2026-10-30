import { beforeEach, describe, expect, it, vi } from 'vitest';

const { state, tx, prismaMock, supportSession, createCustomPriceMock } = vi.hoisted(() => {
  const state = { current: null as any, billing: null as any };
  const tx = {
    platformSchoolInvitation: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUniqueOrThrow: vi.fn(async () => ({ ...state.current, planCode: 'BAND_101_150', studentCount: 130, currentConditionVersion: 2 })),
    },
    platformSchoolInvitationConditionVersion: { create: vi.fn(async () => ({ id: 'version_2' })) },
    platformSchoolInvitationHistory: { create: vi.fn(async () => ({ id: 'history_1' })) },
    platformBillingAccount: { findFirst: vi.fn(async () => state.billing) },
  };
  const prismaMock = {
    platformSchoolInvitation: { findUnique: vi.fn(async () => state.current) },
    platformBillingAccount: { findFirst: vi.fn(async () => state.billing) },
    $transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
  };
  const supportSession = { supportUserId: 'support_1' };
  const createCustomPriceMock = vi.fn(async (input: { studentCount: number }) => ({ stripeProductId: 'prod_custom_v2', stripePriceId: 'price_custom_v2', monthlyAmountCents: 20_000 + Math.max(0, input.studentCount - 25) * 250 }));
  return { state, tx, prismaMock, supportSession, createCustomPriceMock };
});

vi.mock('@alusa/database', () => ({ prisma: prismaMock }));
vi.mock('@/features/support/api/support-api.server', () => ({
  requireSupportApi: async () => ({ ok: true, session: supportSession }),
  recordSupportAccess: vi.fn(),
}));
vi.mock('@/features/school-invitations/custom-price', () => ({
  InvitationStripePriceError: class InvitationStripePriceError extends Error {},
  createCustomInvitationPrice: createCustomPriceMock,
}));
vi.mock('@alusa/platform-billing', () => ({ calculateCustomInvitationMonthlyAmountCents: vi.fn(() => 23_750) }));

import { PATCH } from '@/app/api/admin/school-invitations/[id]/route';

describe('commercial invitation condition versions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.current = {
      id: 'invitation_1', status: 'ACCEPTED', acceptedContaId: 'conta_1', currentConditionVersion: 1,
      conditionType: 'STANDARD', planCode: 'BAND_001_025', studentCount: 20,
      monthlyAmountCents: null, stripePriceId: null, trialDays: 14,
      customBaseMonthlyAmountCents: null, customIncludedStudentCount: null, customMonthlyOverageAmountCents: null, stripeProductId: null,
      schoolName: 'Escola A', contactName: 'Pessoa A', email: 'admin@example.test', expiresAt: new Date('2030-01-01T00:00:00Z'),
    };
    state.billing = null;
    tx.platformSchoolInvitation.updateMany.mockResolvedValue({ count: 1 });
    tx.platformSchoolInvitation.findUniqueOrThrow.mockResolvedValue({ ...state.current, planCode: 'BAND_101_150', studentCount: 130, trialDays: 21, currentConditionVersion: 2 });
  });

  it('saves a new immutable snapshot when an accepted but unbilled school condition changes', async () => {
    const response = await PATCH(new Request('https://admin.test', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conditionType: 'STANDARD', planCode: 'BAND_101_150', studentCount: 130, trialDays: 21 }),
    }), { params: Promise.resolve({ id: 'invitation_1' }) });

    expect(response.status).toBe(200);
    expect(tx.platformSchoolInvitation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'invitation_1', status: 'ACCEPTED', currentConditionVersion: 1 }, data: expect.objectContaining({ currentConditionVersion: 2 }) }));
    expect(tx.platformSchoolInvitationConditionVersion.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ invitationId: 'invitation_1', version: 2, createdBy: 'support_1', snapshot: expect.objectContaining({ planCode: 'BAND_101_150', studentCount: 130, trialDays: 21 }) }) }));
  });

  it('blocks condition edits once any billing account exists', async () => {
    state.billing = { id: 'billing_1' };
    const response = await PATCH(new Request('https://admin.test', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conditionType: 'STANDARD', planCode: 'BAND_101_150', studentCount: 130 }),
    }), { params: Promise.resolve({ id: 'invitation_1' }) });

    expect(response.status).toBe(409);
    expect(tx.platformSchoolInvitationConditionVersion.create).not.toHaveBeenCalled();
  });

  it('rejects changing a pending invitation email before any transaction can mutate it', async () => {
    state.current.status = 'PENDING';
    const response = await PATCH(new Request('https://admin.test', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'new-owner@example.test' }),
    }), { params: Promise.resolve({ id: 'invitation_1' }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ success: false, error: expect.stringContaining('imutável') });
    expect(tx.platformSchoolInvitation.updateMany).not.toHaveBeenCalled();
    expect(tx.platformSchoolInvitationConditionVersion.create).not.toHaveBeenCalled();
    expect(tx.platformSchoolInvitationHistory.create).not.toHaveBeenCalled();
  });

  it('creates a new versioned recurring Price and snapshots the custom overage terms', async () => {
    state.current.conditionType = 'CUSTOM';
    state.current.planCode = null;
    state.current.studentCount = 40;
    state.current.customBaseMonthlyAmountCents = 20_000;
    state.current.customIncludedStudentCount = 25;
    state.current.customMonthlyOverageAmountCents = 250;
    state.current.monthlyAmountCents = 23_750;
    state.current.stripePriceId = 'price_custom_v1';
    state.current.stripeProductId = 'prod_custom_v1';
    tx.platformSchoolInvitation.findUniqueOrThrow.mockResolvedValue({ ...state.current, currentConditionVersion: 2, monthlyAmountCents: 26_250, stripePriceId: 'price_custom_v2', stripeProductId: 'prod_custom_v2' });
    const response = await PATCH(new Request('https://admin.test', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conditionType: 'CUSTOM', studentCount: 50, trialDays: 14, customBaseMonthlyAmountCents: 20_000, customIncludedStudentCount: 25, customMonthlyOverageAmountCents: 250 }),
    }), { params: Promise.resolve({ id: 'invitation_1' }) });

    expect(response.status).toBe(200);
    expect(createCustomPriceMock).toHaveBeenCalledWith(expect.objectContaining({ invitationId: 'invitation_1', version: 2, studentCount: 50, baseMonthlyAmountCents: 20_000, includedStudentCount: 25, monthlyPerStudentOverageCents: 250 }));
    expect(tx.platformSchoolInvitation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ currentConditionVersion: 2, monthlyAmountCents: 26_250, stripePriceId: 'price_custom_v2', stripeProductId: 'prod_custom_v2' }) }));
    expect(tx.platformSchoolInvitationConditionVersion.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ snapshot: expect.objectContaining({ customBaseMonthlyAmountCents: 20_000, customIncludedStudentCount: 25, customMonthlyOverageAmountCents: 250, monthlyAmountCents: 26_250 }) }) }));
  });

  it('does not revoke an invitation when acceptance wins the compare-and-set race', async () => {
    state.current.status = 'PENDING';
    tx.platformSchoolInvitation.updateMany.mockImplementationOnce(async () => {
      state.current.status = 'ACCEPTED';
      return { count: 0 };
    });
    const response = await PATCH(new Request('https://admin.test', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'REVOKE' }),
    }), { params: Promise.resolve({ id: 'invitation_1' }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ currentStatus: 'ACCEPTED' });
    expect(tx.platformSchoolInvitationHistory.create).not.toHaveBeenCalled();
  });

  it('records revoke history only after its pending-state claim succeeds', async () => {
    state.current.status = 'PENDING';
    tx.platformSchoolInvitation.findUniqueOrThrow.mockResolvedValue({ ...state.current, status: 'REVOKED' });
    const response = await PATCH(new Request('https://admin.test', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'REVOKE' }),
    }), { params: Promise.resolve({ id: 'invitation_1' }) });

    expect(response.status).toBe(200);
    expect(tx.platformSchoolInvitation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'invitation_1', status: 'PENDING' }, data: expect.objectContaining({ status: 'REVOKED' }) }));
    expect(tx.platformSchoolInvitationHistory.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'REVOKED' }) }));
  });
});
