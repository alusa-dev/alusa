import { beforeEach, describe, expect, it, vi } from 'vitest';

const { gatewayMock } = vi.hoisted(() => ({
  gatewayMock: {
    previewSubscriptionPlanChange: vi.fn(),
    updateSubscriptionPlan: vi.fn(),
  },
}));

vi.mock('@alusa/platform-billing', () => ({
  PLATFORM_PLANS: {
    STARTER: { maxActiveStudents: 60 },
    PREMIUM: { maxActiveStudents: 150 },
    PRO: { maxActiveStudents: 300 },
  },
  PlatformBillingError: class PlatformBillingError extends Error {
    code: string;
    details?: unknown;

    constructor(message: string, code: string, details?: unknown) {
      super(message);
      this.code = code;
      this.details = details;
    }
  },
  createDefaultPlatformBillingStripeGateway: vi.fn(() => gatewayMock),
  evaluateStudentCapacity: vi.fn(({ activeStudents, planCode }) => {
    const limits: Record<string, number> = { STARTER: 60, PREMIUM: 150, PRO: 300 };
    const maxActiveStudents = limits[planCode] ?? 0;
    return {
      allowed: activeStudents <= maxActiveStudents,
      activeStudents,
      maxActiveStudents,
    };
  }),
  resolveStripePriceId: vi.fn(({ planCode }) => `price_${planCode.toLowerCase()}`),
}));

vi.mock('@/src/server/platform-billing/platform-billing-server', () => ({
  resolvePlatformBillingEnvironment: () => 'TEST',
}));

import { requestPlatformPlanChange } from '@/src/server/platform-billing/plan-change-actions';

describe('requestPlatformPlanChange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gatewayMock.updateSubscriptionPlan.mockResolvedValue({
      id: 'sub_1',
      status: 'trialing',
      priceId: 'price_premium',
      currentPeriodEnd: new Date('2026-07-15T00:00:00.000Z'),
      cancelAtPeriodEnd: false,
      trialEndsAt: new Date('2026-07-15T00:00:00.000Z'),
      pendingUpdateId: null,
    });
  });

  it('troca plano durante trial sem preview invoice nem cobranca imediata', async () => {
    const trialEndsAt = new Date('2026-07-15T00:00:00.000Z');
    const prisma = createPrismaMock({
      account: {
        id: 'billing_account_1',
        contaId: 'conta_1',
        environment: 'TEST',
        status: 'TRIALING',
        planCode: 'STARTER',
        stripeSubscriptionId: 'sub_1',
        stripePriceId: 'price_starter',
        currentPeriodEnd: trialEndsAt,
        trialEndsAt,
      },
      activeStudents: 12,
    });

    const result = await requestPlatformPlanChange({
      prisma: prisma as never,
      contaId: 'conta_1',
      actorUserId: 'user_1',
      targetPlanCode: 'PREMIUM',
      idempotencyKey: 'idem_trial_plan_change',
    });

    expect(result).toMatchObject({
      type: 'UPGRADE',
      status: 'APPLIED',
      message: 'Plano alterado com sucesso.',
    });
    expect(gatewayMock.previewSubscriptionPlanChange).not.toHaveBeenCalled();
    expect(gatewayMock.updateSubscriptionPlan).toHaveBeenCalledWith(expect.objectContaining({
      subscriptionId: 'sub_1',
      priceId: 'price_premium',
      prorationBehavior: 'none',
      paymentBehavior: 'allow_incomplete',
    }));
    expect(prisma.platformBillingAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'billing_account_1' },
      data: expect.objectContaining({
        status: 'TRIALING',
        planCode: 'PREMIUM',
        stripePriceId: 'price_premium',
        pendingPlanCode: null,
        pendingChangeType: null,
        pendingChangeEffectiveAt: null,
      }),
    }));
  });
});

function createPrismaMock(input: {
  account: Record<string, unknown>;
  activeStudents: number;
}) {
  return {
    platformBillingPlanChange: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }) => ({
        id: 'plan_change_1',
        ...data,
      })),
      update: vi.fn(async ({ data }) => ({
        id: 'plan_change_1',
        ...data,
      })),
    },
    platformBillingAccount: {
      findUnique: vi.fn(async () => input.account),
      update: vi.fn(async ({ data }) => ({
        ...input.account,
        ...data,
      })),
    },
    platformBillingAuditLog: {
      create: vi.fn(async ({ data }) => ({ id: 'audit_1', ...data })),
    },
    matricula: {
      findMany: vi.fn(async () =>
        Array.from({ length: input.activeStudents }, (_, index) => ({ alunoId: `aluno_${index}` })),
      ),
    },
  };
}
