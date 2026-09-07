import type { ChargeStatus, Prisma } from '@prisma/client';

import prisma from '@/lib/prisma';
import { buildChargeDisplayStatusDTO } from '@/lib/finance/charge-display-status';

type PortalScopedPayerIds = {
  contaId: string;
  alunoIds: string[];
  responsavelIds: string[];
  matriculaIds: string[];
  familyGroupIds: string[];
};

const FINAL_PORTAL_STATUSES = new Set(['PAGO', 'CANCELADO', 'ESTORNADO']);

export function mapChargeStatusToPortalStatus(status: ChargeStatus, dueDate?: Date | null): string {
  if (status === 'PAID') return 'PAGO';
  if (status === 'CANCELED') return 'CANCELADO';
  if (status === 'REFUNDED') return 'ESTORNADO';
  if (status === 'OVERDUE') return 'ATRASADO';

  const dueTime = dueDate ? new Date(dueDate).getTime() : null;
  if (dueTime != null && Number.isFinite(dueTime)) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (dueTime < today.getTime()) return 'ATRASADO';
  }

  return 'PENDENTE';
}

export function isPortalPendingStatus(status: string): boolean {
  if (FINAL_PORTAL_STATUSES.has(status)) return false;
  return status === 'PENDENTE' || status === 'ATRASADO';
}

export async function resolvePortalScopedPayerIds(
  contaId: string,
  alunoIds: string[],
  portalResponsavelId?: string | null,
): Promise<PortalScopedPayerIds> {
  if (!alunoIds.length) {
    return {
      contaId,
      alunoIds: [],
      responsavelIds: portalResponsavelId ? [portalResponsavelId] : [],
      matriculaIds: [],
      familyGroupIds: [],
    };
  }

  const matriculas = await prisma.matricula.findMany({
    where: { contaId, alunoId: { in: alunoIds } },
    select: { id: true, matriculaFamiliarId: true },
  });
  const matriculaIds = matriculas.map((matricula) => matricula.id);
  const familyGroupIds = new Set(
    matriculas
      .map((matricula) => matricula.matriculaFamiliarId)
      .filter((id): id is string => Boolean(id)),
  );

  if (matriculaIds.length) {
    const familyItems = await prisma.matriculaFamiliarItem.findMany({
      where: {
        matriculaId: { in: matriculaIds },
        matriculaFamiliar: { contaId },
      },
      select: { matriculaFamiliarId: true },
    });
    for (const item of familyItems) familyGroupIds.add(item.matriculaFamiliarId);
  }

  // A student's portal may use a responsible's payment method, but a
  // responsible-only standalone obligation is visible by direct payer only
  // in the responsible portal. Student portals are scoped by the obligation's
  // student/family/sale context, never by a shared Customer alias.
  return {
    contaId,
    alunoIds: [...new Set(alunoIds)],
    responsavelIds: portalResponsavelId ? [portalResponsavelId] : [],
    matriculaIds,
    familyGroupIds: [...familyGroupIds],
  };
}

export function buildPortalStandaloneChargeOwnershipWhere(
  scope: PortalScopedPayerIds,
): Prisma.ChargeWhereInput {
  const where: Prisma.ChargeWhereInput[] = [
    ...(scope.alunoIds.length
      ? [{ payerType: 'ALUNO' as const, payerId: { in: scope.alunoIds } }]
      : []),
    ...(scope.responsavelIds.length
      ? [{ payerType: 'RESPONSAVEL' as const, payerId: { in: scope.responsavelIds } }]
      : []),
    ...(scope.familyGroupIds.length
      ? [
          { familyGroupId: { in: scope.familyGroupIds } },
          {
            standaloneSubscription: {
              contaId: scope.contaId,
              familyGroupId: { in: scope.familyGroupIds },
            },
          },
          {
            standaloneInstallmentPlan: {
              contaId: scope.contaId,
              familyGroupId: { in: scope.familyGroupIds },
            },
          },
        ]
      : []),
    ...(scope.alunoIds.length || scope.matriculaIds.length || scope.responsavelIds.length
      ? [
          {
            sale: {
              contaId: scope.contaId,
              OR: [
                ...(scope.alunoIds.length ? [{ alunoId: { in: scope.alunoIds } }] : []),
                ...(scope.matriculaIds.length ? [{ matriculaId: { in: scope.matriculaIds } }] : []),
                ...(scope.responsavelIds.length ? [{ responsavelId: { in: scope.responsavelIds } }] : []),
              ],
            },
          },
        ]
      : []),
    ...(scope.alunoIds.length
      ? [
          {
            standaloneSubscription: {
              contaId: scope.contaId,
              payerType: 'ALUNO' as const,
              payerId: { in: scope.alunoIds },
            },
          },
          {
            standaloneInstallmentPlan: {
              contaId: scope.contaId,
              payerType: 'ALUNO' as const,
              payerId: { in: scope.alunoIds },
            },
          },
        ]
      : []),
    ...(scope.responsavelIds.length
      ? [
          {
            standaloneSubscription: {
              contaId: scope.contaId,
              payerType: 'RESPONSAVEL' as const,
              payerId: { in: scope.responsavelIds },
            },
          },
          {
            standaloneInstallmentPlan: {
              contaId: scope.contaId,
              payerType: 'RESPONSAVEL' as const,
              payerId: { in: scope.responsavelIds },
            },
          },
        ]
      : []),
  ];

  return where.length ? { OR: where } : { id: '__no_portal_scope__' };
}

export async function listPortalStandaloneCharges(params: {
  contaId: string;
  alunoIds: string[];
  responsavelId?: string | null;
}) {
  const payerScope = await resolvePortalScopedPayerIds(
    params.contaId,
    params.alunoIds,
    params.responsavelId,
  );
  const ownershipWhere = buildPortalStandaloneChargeOwnershipWhere(payerScope);

  const charges = await prisma.charge.findMany({
    where: {
      contaId: params.contaId,
      cobrancaId: null,
      ...ownershipWhere,
    },
    select: {
      id: true,
      status: true,
      value: true,
      dueDate: true,
      billingType: true,
      asaasPaymentId: true,
      asaasStatus: true,
      liquidacaoStatus: true,
      invoiceUrl: true,
      payerName: true,
      description: true,
    },
    orderBy: [
      { dueDate: 'desc' },
      { createdAt: 'desc' },
    ],
  });

  return charges.map((charge) => {
    const vencimento = charge.dueDate ?? new Date();
    const localStatus = mapChargeStatusToPortalStatus(charge.status, charge.dueDate);
    const displayStatus = buildChargeDisplayStatusDTO({
      localStatus: charge.status,
      asaasStatus: charge.asaasStatus,
      liquidacaoStatus: charge.liquidacaoStatus,
      hasAsaasLink: Boolean(charge.asaasPaymentId),
    });

    return {
      id: charge.id,
      tipo: 'AVULSA',
      valor: Number(charge.value ?? 0),
      vencimento,
      status: localStatus,
      displayStatus,
      asaasStatus: charge.asaasStatus,
      liquidacaoStatus: charge.liquidacaoStatus,
      formaPagamento: charge.billingType ?? null,
      asaasId: charge.asaasPaymentId ?? null,
      invoiceUrl: charge.invoiceUrl ?? null,
      descricao: charge.description ?? null,
      matricula: {
        aluno: {
          nome: charge.payerName ?? 'Pagador não identificado',
        },
        turma: null,
        responsavelFinanceiro: null,
      },
      pagamentos: [],
    };
  });
}
