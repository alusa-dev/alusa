import { describe, expect, it, vi } from 'vitest';
import { createCommercialSchoolInvitation, updateCommercialSchoolInvitation } from '@/features/school-invitations/use-cases';

describe('commercial school invitation use cases', () => {
  it('persists a versioned custom proposal and records ambiguous email delivery without losing the actionable link', async () => {
    const invitation = {
      id: 'school_invitation_123', email: 'admin@example.test', schoolName: 'Escola Nova', expiresAt: new Date('2030-01-01T00:00:00Z'),
    };
    const tx = {
      platformSchoolInvitation: {
        create: vi.fn(async () => invitation), update: vi.fn(async () => invitation), updateMany: vi.fn(async () => ({ count: 1 })),
      },
      platformSchoolInvitationConditionVersion: { create: vi.fn(async () => ({})) },
      platformSchoolInvitationHistory: { create: vi.fn(async () => ({})) },
    };
    const db = {
      platformSchoolInvitation: { findUnique: vi.fn(async () => null), update: vi.fn(async () => invitation) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as never;
    const sendEmail = vi.fn(async () => { throw Object.assign(new Error('ambiguous'), { code: 'EMAIL_DELIVERY_AMBIGUOUS' }); });
    const result = await createCommercialSchoolInvitation({
      db,
      data: {
        schoolName: 'Escola Nova', contactName: 'Pessoa', email: 'admin@example.test', conditionType: 'CUSTOM', studentCount: 40, planCode: undefined,
        customBaseMonthlyAmountCents: 20_000, customIncludedStudentCount: 25, customMonthlyOverageAmountCents: 250, trialDays: 14,
      },
      requestIdempotencyKey: 'request-1', token: 'opaque-token', expiresAt: invitation.expiresAt,
      createdByAdminId: 'support-1', baseUrl: 'https://alusa.test',
      createPrice: vi.fn(async () => ({ stripeProductId: 'prod_1', stripePriceId: 'price_1', monthlyAmountCents: 23_750 })),
      sendEmail,
    });

    expect(result).toMatchObject({ kind: 'created', data: { url: 'https://alusa.test/convite-escola/opaque-token', emailDeliveryStatus: 'UNKNOWN' } });
    expect(tx.platformSchoolInvitationConditionVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ version: 1, snapshot: expect.objectContaining({ monthlyAmountCents: 23_750, stripePriceId: 'price_1' }) }),
    }));
    expect(tx.platformSchoolInvitationHistory.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'EMAIL_DELIVERY_UNKNOWN' }) }));
  });

  it('rejects an edit that lost the version compare-and-set without writing history', async () => {
    const current = {
      id: 'invitation-1', status: 'PENDING', acceptedContaId: null, currentConditionVersion: 2,
      conditionType: 'STANDARD', planCode: 'BAND_001_025', studentCount: 20, monthlyAmountCents: null,
      customBaseMonthlyAmountCents: null, customIncludedStudentCount: null, customMonthlyOverageAmountCents: null,
      stripePriceId: null, stripeProductId: null, trialDays: 14, schoolName: 'Escola', contactName: 'Pessoa',
      email: 'admin@example.test', expiresAt: new Date('2030-01-01T00:00:00Z'),
    };
    const tx = {
      platformSchoolInvitation: { updateMany: vi.fn(async () => ({ count: 0 })), findUniqueOrThrow: vi.fn() },
      platformSchoolInvitationConditionVersion: { create: vi.fn() },
      platformSchoolInvitationHistory: { create: vi.fn() },
      platformBillingAccount: { findFirst: vi.fn(async () => null) },
    };
    const db = {
      platformSchoolInvitation: { findUnique: vi.fn(async () => current) },
      platformBillingAccount: { findFirst: vi.fn(async () => null) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as never;

    const result = await updateCommercialSchoolInvitation({
      db, id: current.id, actorId: 'support-1',
      changes: { action: 'UPDATE', conditionType: 'STANDARD', planCode: 'BAND_026_050', studentCount: 30 },
    });

    expect(result).toMatchObject({ kind: 'conflict', reason: 'INVITATION_CHANGED_CONCURRENTLY' });
    expect(tx.platformSchoolInvitationConditionVersion.create).not.toHaveBeenCalled();
    expect(tx.platformSchoolInvitationHistory.create).not.toHaveBeenCalled();
  });

  it('persists the standard plan band derived from the edited student count', async () => {
    const state = { current: {
      id: 'invitation-2', status: 'PENDING', acceptedContaId: null, currentConditionVersion: 1,
      conditionType: 'STANDARD', planCode: 'BAND_001_025', studentCount: 20, monthlyAmountCents: null,
      customBaseMonthlyAmountCents: null, customIncludedStudentCount: null, customMonthlyOverageAmountCents: null,
      stripePriceId: null, stripeProductId: null, trialDays: 14, schoolName: 'Escola', contactName: 'Pessoa',
      email: 'admin@example.test', expiresAt: new Date('2030-01-01T00:00:00Z'),
    } };
    const tx = {
      platformSchoolInvitation: {
        updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(state.current, data);
          return { count: 1 };
        }),
        findUniqueOrThrow: vi.fn(async () => state.current),
      },
      platformSchoolInvitationConditionVersion: { create: vi.fn(async () => ({})) },
      platformSchoolInvitationHistory: { create: vi.fn(async () => ({})) },
      platformBillingAccount: { findFirst: vi.fn(async () => null) },
    };
    const db = {
      platformSchoolInvitation: { findUnique: vi.fn(async () => state.current) },
      platformBillingAccount: { findFirst: vi.fn(async () => null) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as never;

    const result = await updateCommercialSchoolInvitation({
      db, id: state.current.id, actorId: 'support-1',
      changes: { action: 'UPDATE', conditionType: 'STANDARD', studentCount: 250, planCode: 'BAND_001_025' },
    });

    expect(result).toMatchObject({ kind: 'updated' });
    expect(tx.platformSchoolInvitation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ studentCount: 250, planCode: 'BAND_201_300' }),
    }));
    expect(tx.platformSchoolInvitationConditionVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ snapshot: expect.objectContaining({ studentCount: 250, planCode: 'BAND_201_300' }) }),
    }));
  });
});
