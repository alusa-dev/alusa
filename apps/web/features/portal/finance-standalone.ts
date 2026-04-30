import type { ChargeStatus } from '@prisma/client';

import prisma from '@/lib/prisma';

type PortalScopedPayerIds = {
  alunoIds: string[];
  responsavelIds: string[];
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
): Promise<PortalScopedPayerIds> {
  if (!alunoIds.length) return { alunoIds: [], responsavelIds: [] };

  const responsavelLinks = await prisma.alunoResponsavel.findMany({
    where: {
      alunoId: { in: alunoIds },
      responsavel: { contaId },
    },
    select: { responsavelId: true },
  });

  const responsavelIds = Array.from(new Set(responsavelLinks.map((item) => item.responsavelId)));
  return { alunoIds, responsavelIds };
}

export async function listPortalStandaloneCharges(params: {
  contaId: string;
  alunoIds: string[];
}) {
  const payerScope = await resolvePortalScopedPayerIds(params.contaId, params.alunoIds);

  const payerFilters: Array<{ customer: { payerType: 'ALUNO' | 'RESPONSAVEL'; payerId: { in: string[] } } }> = [];
  if (payerScope.alunoIds.length) {
    payerFilters.push({ customer: { payerType: 'ALUNO', payerId: { in: payerScope.alunoIds } } });
  }
  if (payerScope.responsavelIds.length) {
    payerFilters.push({ customer: { payerType: 'RESPONSAVEL', payerId: { in: payerScope.responsavelIds } } });
  }

  if (!payerFilters.length) return [];

  const charges = await prisma.charge.findMany({
    where: {
      contaId: params.contaId,
      cobrancaId: null,
      OR: payerFilters,
    },
    select: {
      id: true,
      status: true,
      value: true,
      dueDate: true,
      billingType: true,
      asaasPaymentId: true,
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
    const status = mapChargeStatusToPortalStatus(charge.status, charge.dueDate);

    return {
      id: charge.id,
      tipo: 'AVULSA',
      valor: Number(charge.value ?? 0),
      vencimento,
      status,
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
