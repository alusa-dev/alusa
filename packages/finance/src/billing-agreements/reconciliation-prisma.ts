import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';

import type {
  BillingIntegrityAgreement,
  BillingIntegrityCharge,
  BillingIntegrityRepository,
  BillingIntegrityRepairAction,
  BillingIntegritySnapshot,
} from './reconciliation';

function cents(value: Prisma.Decimal | number | null | undefined): number {
  return Math.round(Number(value ?? 0) * 100);
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function chargeStatus(localStatus: string, remoteStatus?: string | null): string {
  const status = remoteStatus ?? localStatus;
  const aliases: Record<string, string> = {
    PAID: 'RECEIVED',
    PAGO: 'RECEIVED',
    PENDENTE: 'PENDING',
    A_VENCER: 'PENDING',
    ATRASADO: 'OVERDUE',
    CANCELADO: 'DELETED',
    ESTORNADO: 'REFUNDED',
    ESTORNADO_PARCIAL: 'REFUNDED',
  };
  return aliases[status] ?? status;
}

function adjustmentReference(action: BillingIntegrityRepairAction): string {
  return `billing-integrity-repair:${action.id}`;
}

/** Adapter Prisma estritamente tenant-scoped. Não faz leitura ou escrita no Asaas. */
export function createPrismaBillingIntegrityRepository(prisma: PrismaClient): BillingIntegrityRepository {
  return {
    async loadSnapshot(input): Promise<BillingIntegritySnapshot> {
      const [enrollments, rows] = await Promise.all([
        prisma.matricula.findMany({
          where: { contaId: input.contaId, billingProvisionStatus: 'PROVISIONADO' },
          select: {
            id: true,
            billingProvisionStatus: true,
            cobrancas: {
              where: {
                tipo: 'MENSALIDADE',
                asaasPaymentId: { not: null },
              },
              select: { id: true, status: true, asaasStatus: true },
            },
          },
        }),
        prisma.billingAgreement.findMany({
          where: { contaId: input.contaId },
          include: {
            allocations: {
              include: { sourceCharge: { include: { cobranca: true } } },
              orderBy: [{ validFrom: 'asc' }, { id: 'asc' }],
            },
            adjustments: true,
            legacySubscriptions: {
              include: { matricula: { include: { cobrancas: { include: { charge: true } } } } },
            },
            legacyStandaloneSubscriptions: {
              include: { charges: { include: { cobranca: true } } },
            },
          },
          orderBy: { id: 'asc' },
        }),
      ]);

      const agreements: BillingIntegrityAgreement[] = rows.map((row) => {
        const charges = new Map<string, BillingIntegrityCharge>();
        const addCharge = (charge: BillingIntegrityCharge) => charges.set(charge.id, charge);
        for (const allocation of row.allocations) {
          const charge = allocation.sourceCharge;
          if (!charge) continue;
          addCharge({
            id: charge.id,
            status: chargeStatus(charge.status, charge.asaasStatus),
            amountCents: cents(charge.asaasValue ?? charge.value ?? charge.cobranca?.valor),
            dueDate: dateOnly(charge.dueDate ?? charge.cobranca?.vencimento ?? charge.createdAt),
          });
        }
        for (const subscription of row.legacySubscriptions) {
          for (const cobranca of subscription.matricula.cobrancas) {
            addCharge({
              id: cobranca.charge?.id ?? `cobranca:${cobranca.id}`,
              status: chargeStatus(cobranca.status, cobranca.asaasStatus),
              amountCents: cents(cobranca.asaasValue ?? cobranca.valor),
              dueDate: dateOnly(cobranca.vencimento),
            });
          }
        }
        for (const subscription of row.legacyStandaloneSubscriptions) {
          for (const charge of subscription.charges) {
            addCharge({
              id: charge.id,
              status: chargeStatus(charge.status, charge.asaasStatus),
              amountCents: cents(charge.asaasValue ?? charge.value ?? charge.cobranca?.valor),
              dueDate: dateOnly(charge.dueDate ?? charge.cobranca?.vencimento ?? charge.createdAt),
            });
          }
        }
        return {
          id: row.id,
          status: row.status,
          desiredAmountCents: cents(row.desiredValue),
          confirmedAmountCents: cents(row.confirmedValue),
          asaasSubscriptionId: row.asaasSubscriptionId,
          remoteStatus: row.remoteStatus,
          allocations: row.allocations.map((allocation) => ({
            id: allocation.id,
            agreementId: allocation.agreementId,
            enrollmentId: allocation.matriculaId,
            kind: allocation.kind,
            status: allocation.status,
            recurring: allocation.recurring,
            netAmountCents: cents(allocation.netAmount),
            validFrom: dateOnly(allocation.validFrom),
            validUntil: allocation.validUntil ? dateOnly(allocation.validUntil) : null,
          })),
          charges: [...charges.values()].sort((left, right) => left.dueDate.localeCompare(right.dueDate)),
          adjustments: row.adjustments.map((adjustment) => ({
            id: adjustment.id,
            type: adjustment.type,
            status: adjustment.status,
            amountCents: cents(adjustment.amount),
            effectiveDate: dateOnly(adjustment.effectiveAt),
            chargeId: adjustment.chargeId,
          })),
        };
      });
      return {
        contaId: input.contaId,
        enrollments: enrollments.map((enrollment) => ({
          id: enrollment.id,
          billingProvisionStatus: enrollment.billingProvisionStatus,
          hasProvisionedOneTimeTuition: enrollment.cobrancas.some((charge) =>
            !['CANCELADO', 'ESTORNADO', 'ESTORNADO_PARCIAL', 'DELETED', 'REFUNDED', 'REFUND_REQUESTED', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE'].includes(
              chargeStatus(charge.status, charge.asaasStatus),
            ),
          ),
        })),
        agreements,
      };
    },

    async applyRepair(input) {
      const action = input.action;
      if (action.kind === 'MARK_ENROLLMENT_PARTIAL') {
        if (!action.enrollmentId) throw new Error('Ação sem enrollmentId.');
        const updated = await prisma.matricula.updateMany({
          where: {
            id: action.enrollmentId,
            contaId: input.contaId,
            billingProvisionStatus: 'PROVISIONADO',
          },
          data: {
            billingProvisionStatus: 'PARCIAL',
            billingProvisionError: action.issueCode,
          },
        });
        return updated.count === 1 ? 'APPLIED' : 'ALREADY_APPLIED';
      }

      if (!action.agreementId) throw new Error('Ação de acordo sem agreementId.');
      const agreement = await prisma.billingAgreement.findFirst({
        where: { id: action.agreementId, contaId: input.contaId },
        select: { id: true, desiredValue: true, status: true },
      });
      if (!agreement) throw new Error('BillingAgreement não encontrado no tenant solicitado.');

      if (action.kind === 'ALIGN_AGREEMENT_DESIRED_AMOUNT') {
        if (action.amountCents === null) throw new Error('Ação sem amountCents.');
        if (cents(agreement.desiredValue) === action.amountCents) return 'ALREADY_APPLIED';
        const updated = await prisma.billingAgreement.updateMany({
          where: { id: action.agreementId, contaId: input.contaId },
          data: { desiredValue: action.amountCents / 100, version: { increment: 1 } },
        });
        if (updated.count !== 1) throw new Error('Falha concorrente ao alinhar BillingAgreement.');
        return 'APPLIED';
      }

      if (action.kind === 'MARK_AGREEMENT_REQUIRES_RECONCILIATION') {
        if (agreement.status === 'REQUIRES_RECONCILIATION') return 'ALREADY_APPLIED';
        if (agreement.status === 'CANCELLED') return 'ALREADY_APPLIED';
        const updated = await prisma.billingAgreement.updateMany({
          where: { id: action.agreementId, contaId: input.contaId, status: { not: 'CANCELLED' } },
          data: {
            status: 'REQUIRES_RECONCILIATION',
            reconciliationError: action.issueCode,
          },
        });
        if (updated.count !== 1) throw new Error('Falha concorrente ao sinalizar BillingAgreement.');
        return 'APPLIED';
      }

      if (action.kind === 'CREATE_COMPLEMENT_ADJUSTMENT') {
        if (action.amountCents === null || action.amountCents <= 0 || !action.effectiveDate) {
          throw new Error('Ação de complemento incompleta.');
        }
        const idempotencyKey = adjustmentReference(action);
        const sourceCharge = action.chargeId
          ? await prisma.charge.findFirst({
              where: { id: action.chargeId, contaId: input.contaId },
              select: { id: true },
            })
          : null;
        const existing = await prisma.billingAdjustment.findUnique({
          where: {
            uq_billing_adjustment_conta_idempotency: { contaId: input.contaId, idempotencyKey },
          },
          select: { id: true },
        });
        if (existing) return 'ALREADY_APPLIED';
        try {
          await prisma.billingAdjustment.create({
            data: {
              contaId: input.contaId,
              agreementId: action.agreementId,
              type: 'COMPLEMENT',
              status: 'PENDING',
              amount: action.amountCents / 100,
              effectiveAt: new Date(`${action.effectiveDate}T00:00:00.000Z`),
              idempotencyKey,
              externalReference: idempotencyKey,
              chargeId: sourceCharge?.id ?? null,
              result: { source: 'billing-integrity-reconciliation', issueCode: action.issueCode },
            },
          });
          return 'APPLIED';
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            return 'ALREADY_APPLIED';
          }
          throw error;
        }
      }

      return 'ALREADY_APPLIED';
    },
  };
}
