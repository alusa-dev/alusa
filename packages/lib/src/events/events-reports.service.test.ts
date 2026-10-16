import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  schoolEvent: { findMany: vi.fn() },
  eventFinancialPayment: { findMany: vi.fn() },
  usuarioConta: { findMany: vi.fn() },
  eventBillingGroup: { findMany: vi.fn() },
  charge: { findMany: vi.fn() },
  standaloneInstallmentPlan: { findMany: vi.fn() },
}));

vi.mock('../prisma', () => ({ prisma: db }));

import { getEventReports } from './events.service';

function reportEvent(contaId: string) {
  const suffix = contaId === 'tenant-a' ? 'a' : 'b';
  const amount = suffix === 'a' ? 10 : 25;
  return {
    id: `event-${suffix}`,
    contaId,
    name: `Evento ${suffix.toUpperCase()}`,
    description: null,
    type: 'OTHER',
    status: 'ACTIVE',
    startsAt: new Date('2026-10-01T12:00:00Z'),
    endsAt: null,
    locationName: null,
    locationAddress: null,
    estimatedCapacity: null,
    responsibleUserId: `responsible-${suffix}`,
    responsibleUser: {
      id: `responsible-${suffix}`,
      nome: `Responsável ${suffix.toUpperCase()}`,
      email: `responsavel-${suffix}@example.invalid`,
      contaId,
      acessosConta: [{ contaId, status: 'ATIVO' }],
    },
    createdByUserId: null,
    createdBy: null,
    hasTickets: false,
    ticketMode: 'NONE',
    hasCostumes: false,
    hasFinancialControl: true,
    registrationFee: new Prisma.Decimal(amount),
    paymentInterestValue: null,
    paymentFineValue: null,
    paymentFineType: null,
    paymentDiscountValue: null,
    paymentDiscountType: null,
    paymentDiscountDueDateLimitDays: null,
    contratoModeloId: null,
    notes: null,
    ticketArtworkUrl: null,
    ticketArtworkStorageKey: null,
    createdAt: new Date('2026-09-01T12:00:00Z'),
    updatedAt: new Date('2026-09-01T12:00:00Z'),
    cancelledAt: null,
    finishedAt: null,
    archivedAt: null,
    ticketLots: [],
    ticketSales: [],
    costumes: [],
    assignments: [],
    financialEntries: [],
    participants: [{
      id: `participant-${suffix}`,
      contaId,
      revenueEntryId: `entry-${suffix}`,
      asaasPaymentId: `payment-${suffix}`,
      asaasInstallmentId: null,
      billingGroupId: `group-${suffix}`,
      balanceAmount: new Prisma.Decimal(amount),
      registrationFeeCharged: new Prisma.Decimal(amount),
      registrationFeeOriginal: new Prisma.Decimal(amount),
      registrationFeeDiscount: new Prisma.Decimal(0),
      feePaidAmount: new Prisma.Decimal(0),
      feeRefundedAmount: new Prisma.Decimal(0),
      isFeePaid: false,
      isFeeExempt: false,
      cancelledAt: null,
    }],
  };
}

const reportsByTenant = {
  'tenant-a': reportEvent('tenant-a'),
  'tenant-b': reportEvent('tenant-b'),
} as const;
const reportRelations = ['ticketSales', 'ticketLots', 'costumes', 'assignments', 'financialEntries', 'participants'] as const;
const eventAWithForeignChildren = {
  ...reportsByTenant['tenant-a'],
  responsibleUserId: 'responsible-b',
  responsibleUser: {
    id: 'responsible-b', nome: 'Nome privado B', email: 'private-b@example.invalid', contaId: 'tenant-b', acessosConta: [],
  },
  ticketSales: [{ contaId: 'tenant-b', status: 'PENDING', quantity: 1, totalAmount: new Prisma.Decimal(999) }],
  ticketLots: [{ contaId: 'tenant-b', status: 'ACTIVE', quantityTotal: 10, quantitySold: 0, unitPrice: new Prisma.Decimal(999) }],
  costumes: [{ contaId: 'tenant-b', id: 'costume-b', schoolCost: new Prisma.Decimal(999), quantity: 1 }],
  assignments: [{ contaId: 'tenant-b', revenueEntryId: null, status: 'PENDING', billingMode: 'SEPARATE_CHARGE', chargedValue: new Prisma.Decimal(999), isPaid: false }],
  financialEntries: [{
    contaId: 'tenant-b', id: 'entry-b-related', type: 'REVENUE', status: 'PENDING', expectedAmount: new Prisma.Decimal(999),
    grossAmount: new Prisma.Decimal(999), discountAmount: new Prisma.Decimal(0), netAmount: null, actualAmount: null,
    refundedAmount: new Prisma.Decimal(0), originType: 'MANUAL', originId: null, costClass: null, category: 'Tenant B',
    asaasPaymentId: 'payment-b', realizedAt: null,
  }],
  participants: [
    reportsByTenant['tenant-a'].participants[0],
    {
      ...reportsByTenant['tenant-b'].participants[0],
      contaId: 'tenant-b', registrationFeeCharged: new Prisma.Decimal(999),
      registrationFeeOriginal: new Prisma.Decimal(999), balanceAmount: new Prisma.Decimal(999),
    },
  ],
};
const chargeFixtures = {
  'tenant-a': [{ id: 'charge-a', contaId: 'tenant-a', asaasPaymentId: 'payment-a', standaloneInstallmentPlanId: null, status: 'RECEIVED', value: new Prisma.Decimal(10), amount: new Prisma.Decimal(10), paidValue: new Prisma.Decimal(10), refundedValue: new Prisma.Decimal(0) }],
  'tenant-b': [{ id: 'charge-b', contaId: 'tenant-b', asaasPaymentId: 'payment-b', standaloneInstallmentPlanId: null, status: 'RECEIVED', value: new Prisma.Decimal(25), amount: new Prisma.Decimal(25), paidValue: new Prisma.Decimal(25), refundedValue: new Prisma.Decimal(0) }],
} as const;

describe('getEventReports tenant isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.schoolEvent.findMany.mockImplementation(async ({ where, select }: {
      where: { contaId: keyof typeof reportsByTenant };
      select: Record<string, { where?: { contaId?: string }; select?: Record<string, unknown> }>;
    }) => {
      const row = where.contaId === 'tenant-a' ? eventAWithForeignChildren : reportsByTenant[where.contaId];
      const filteredRelations = Object.fromEntries(reportRelations.map((relation) => {
        const children = row[relation] as Array<{ contaId: string }>;
        const childContaId = select[relation]?.where?.contaId;
        return [relation, childContaId ? children.filter((child) => child.contaId === childContaId) : children];
      }));
      return [{ ...row, ...filteredRelations }];
    });
    db.eventFinancialPayment.findMany.mockResolvedValue([]);
    db.usuarioConta.findMany.mockImplementation(async ({ where }: { where: { contaId: keyof typeof reportsByTenant; usuarioId: { in: string[] }; status: string } }) => {
      const memberships = [
        { usuarioId: 'responsible-a', contaId: 'tenant-a', status: 'ATIVO' },
        { usuarioId: 'responsible-b', contaId: 'tenant-b', status: 'ATIVO' },
      ];
      return memberships.filter((membership) =>
        membership.contaId === where.contaId && membership.status === where.status && where.usuarioId.in.includes(membership.usuarioId),
      );
    });
    db.eventBillingGroup.findMany.mockImplementation(async ({ where }: { where: { contaId: keyof typeof reportsByTenant; id: { in: string[] } } }) => {
      const suffix = where.contaId === 'tenant-a' ? 'a' : 'b';
      return [{ id: `group-${suffix}`, standaloneChargeId: null, asaasPaymentId: `payment-${suffix}`, asaasInstallmentId: null, balanceAmount: new Prisma.Decimal(suffix === 'a' ? 10 : 25) }];
    });
    db.charge.findMany.mockImplementation(async ({ where }: { where: { contaId: keyof typeof reportsByTenant } }) => chargeFixtures[where.contaId]);
    db.standaloneInstallmentPlan.findMany.mockResolvedValue([]);
  });

  it('calcula o ticket medio geral somente com receita liquida e quantidade de ingressos pagos', async () => {
    db.schoolEvent.findMany.mockResolvedValueOnce([{
      ...reportsByTenant['tenant-a'],
      ticketSales: [{
        contaId: 'tenant-a', status: 'PAID', quantity: 2,
        totalAmount: new Prisma.Decimal(100), refundedAmount: new Prisma.Decimal(20),
      }],
    }] as never);

    const report = await getEventReports({ contaId: 'tenant-a' });

    // R$ 10 of participant revenue is included in overall revenue, but not ticket average.
    expect(report.general.receita).toBe(90);
    expect(report.general.ingressos).toBe(2);
    expect(report.general.ticketMedio).toBe(40);
    expect(db.schoolEvent.findMany.mock.calls[0]?.[0].select.ticketSales.select.refundedAmount).toBe(true);
  });

  it('keeps aggregate and downstream payment snapshot queries inside each tenant', async () => {
    const tenantA = await getEventReports({ contaId: 'tenant-a' });
    const tenantACalls = {
      events: [...db.schoolEvent.findMany.mock.calls],
      memberships: [...db.usuarioConta.findMany.mock.calls],
      payments: [...db.eventFinancialPayment.findMany.mock.calls],
      groups: [...db.eventBillingGroup.findMany.mock.calls],
      charges: [...db.charge.findMany.mock.calls],
      plans: [...db.standaloneInstallmentPlan.findMany.mock.calls],
    };
    const tenantB = await getEventReports({ contaId: 'tenant-b' });

    expect(tenantA.events.map((event) => event.id)).toEqual(['event-a']);
    expect(tenantB.events.map((event) => event.id)).toEqual(['event-b']);
    expect(tenantA.events[0]?.metrics.receitaRealizada).toBe(10);
    expect(tenantA.events[0]?.metrics.receitaPrevista).toBe(10);
    expect(tenantB.events[0]?.metrics.receitaRealizada).toBe(25);
    expect(JSON.stringify(tenantA)).not.toContain('tenant-b');
    expect(JSON.stringify(tenantA)).not.toContain('payment-b');
    expect(JSON.stringify(tenantA)).not.toContain('charge-b');
    expect(tenantA.selected?.responsibleUserId).toBeNull();
    expect(tenantA.selected?.responsibleUser).toBeNull();
    expect(JSON.stringify(tenantA)).not.toContain('responsible-b');
    expect(JSON.stringify(tenantA)).not.toContain('Nome privado B');
    expect(JSON.stringify(tenantA)).not.toContain('private-b@example.invalid');
    expect(tenantB.selected?.responsibleUser).toEqual({ id: 'responsible-b', nome: 'Responsável B' });

    for (const calls of Object.values(tenantACalls)) {
      expect(calls.length).toBeGreaterThan(0);
      for (const [args] of calls) expect(args.where.contaId).toBe('tenant-a');
    }
    const reportSelect = tenantACalls.events[0]?.[0].select;
    for (const relation of reportRelations) {
      expect(reportSelect?.[relation].where).toEqual({ contaId: 'tenant-a' });
    }
    expect(reportSelect?.responsibleUser.select).toEqual({ id: true, nome: true });
    expect(reportSelect?.responsibleUser.select).not.toHaveProperty('email');
    expect(reportSelect).not.toHaveProperty('ticketArtworkStorageKey');
    expect(tenantACalls.memberships[0]?.[0].where).toEqual({
      contaId: 'tenant-a', usuarioId: { in: ['responsible-b'] }, status: 'ATIVO',
    });
    expect(tenantACalls.payments.map(([args]) => args.where.financialEntryId.in)).toEqual([['entry-a']]);
    expect(tenantACalls.groups.map(([args]) => args.where.id.in)).toEqual([['group-a']]);
    const chargeProjection = {
      id: true,
      dueDate: true,
      asaasPaymentId: true,
      standaloneInstallmentPlanId: true,
      status: true,
      statusUpdatedAt: true,
      value: true,
      paidValue: true,
      amount: true,
      refundedValue: true,
    };
    expect(tenantACalls.charges.map(([args]) => args.select)).toEqual([chargeProjection, chargeProjection]);
    expect(JSON.stringify(tenantACalls.charges)).toContain('payment-a');
    expect(JSON.stringify(tenantACalls.charges)).not.toContain('payment-b');
    expect(JSON.stringify(tenantACalls.charges)).not.toContain('charge-b');
    for (const delegate of [db.eventFinancialPayment.findMany, db.eventBillingGroup.findMany, db.charge.findMany, db.standaloneInstallmentPlan.findMany]) {
      expect(delegate).toHaveBeenCalled();
      for (const [args] of delegate.mock.calls) {
        expect(['tenant-a', 'tenant-b']).toContain(args.where.contaId);
      }
    }

    const tenantAChargeQueries = db.charge.findMany.mock.calls.filter(([args]) => args.where.contaId === 'tenant-a');
    const tenantBChargeQueries = db.charge.findMany.mock.calls.filter(([args]) => args.where.contaId === 'tenant-b');
    expect(tenantAChargeQueries).toHaveLength(2);
    expect(tenantBChargeQueries).toHaveLength(2);
    expect(JSON.stringify(tenantAChargeQueries.map(([args]) => args.where))).not.toContain('payment-b');
    expect(JSON.stringify(tenantBChargeQueries.map(([args]) => args.where))).not.toContain('payment-a');
    expect(JSON.stringify(tenantACalls.plans)).toContain('payment-a');
    expect(JSON.stringify(tenantACalls.plans)).not.toContain('payment-b');
    for (const [args] of tenantACalls.plans) {
      expect(args.select).toEqual({
        id: true,
        asaasInstallmentId: true,
        charges: { where: { contaId: 'tenant-a' }, select: chargeProjection },
      });
    }
  });

  it('redacts a legacy owner when the user has a membership in another tenant', async () => {
    db.usuarioConta.findMany.mockResolvedValueOnce([]);
    db.schoolEvent.findMany.mockResolvedValueOnce([{
      ...reportsByTenant['tenant-a'],
      responsibleUserId: 'legacy-a-with-b-membership',
      responsibleUser: {
        id: 'legacy-a-with-b-membership',
        nome: 'Nome legado privado',
        email: 'legacy-private@example.invalid',
        contaId: 'tenant-a',
        acessosConta: [{ contaId: 'tenant-b', status: 'ATIVO' }],
      },
    }] as never);

    const report = await getEventReports({ contaId: 'tenant-a' });

    expect(report.selected?.responsibleUserId).toBeNull();
    expect(report.selected?.responsibleUser).toBeNull();
    expect(JSON.stringify(report)).not.toContain('legacy-a-with-b-membership');
    expect(JSON.stringify(report)).not.toContain('Nome legado privado');
    expect(JSON.stringify(report)).not.toContain('legacy-private@example.invalid');
  });

  it('does not infer legacy access when tenant RLS hides memberships from another account', async () => {
    db.usuarioConta.findMany.mockResolvedValueOnce([]);
    db.schoolEvent.findMany.mockResolvedValueOnce([{
      ...reportsByTenant['tenant-a'],
      responsibleUserId: 'legacy-a-hidden-b-member',
      responsibleUser: {
        id: 'legacy-a-hidden-b-member',
        nome: 'Nome oculto por RLS',
        contaId: 'tenant-a',
        // This is what Prisma can return inside Conta A's RLS transaction:
        // membership in B exists globally, but the related row is invisible.
        acessosConta: [],
      },
    }] as never);

    const report = await getEventReports({ contaId: 'tenant-a' });

    expect(report.selected?.responsibleUserId).toBeNull();
    expect(report.selected?.responsibleUser).toBeNull();
    expect(JSON.stringify(report)).not.toContain('legacy-a-hidden-b-member');
    expect(JSON.stringify(report)).not.toContain('Nome oculto por RLS');
  });
});
