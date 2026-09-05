import { runWithTenant } from '@/lib/prisma-tenant';
import { buildCriarMatriculaResultFromExisting } from './matricula.service';
import { mapCreateMatriculaResultToDTO } from '@/features/cadastro/matriculas/mappers';

/** Read-only recovery: never provisions, compensates or changes a financial state. */
export async function readEnrollmentCreationStatus(contaId: string, uiRequestId: string) {
  const { operation, enrollment } = await runWithTenant(contaId, async (tx) => {
    const operation = await tx.enrollmentCreationOperation.findFirst({
      where: { contaId, uiRequestId },
      select: { status: true, asaasSubscriptionId: true },
    });
    const enrollment = await tx.matricula.findFirst({
      where: { contaId, uiRequestId },
      include: {
        cobrancas: { orderBy: { createdAt: 'asc' } },
        descontos: { include: { desconto: true } },
        plano: { select: { valor: true } },
        combo: { select: { valor: true } },
      },
    });
    return { operation, enrollment };
  });

  if (enrollment) {
    if (
      ['RECUSADA', 'CANCELADA'].includes(enrollment.status) ||
      ['FALHO', 'RESULTADO_INCERTO'].includes(enrollment.billingProvisionStatus) ||
      (operation && operation.asaasSubscriptionId !== enrollment.asaasSubscriptionId)
    ) {
      return { status: 'REQUIRES_RECONCILIATION' as const };
    }
    if (['PENDENTE', 'PROCESSANDO', 'PARCIAL'].includes(enrollment.billingProvisionStatus)) {
      return { status: 'PROCESSING' as const };
    }
    return {
      status: 'COMMITTED' as const,
      result: mapCreateMatriculaResultToDTO({
        result: await buildCriarMatriculaResultFromExisting(enrollment),
        taxaSync: null,
        subscriptionSync: null,
      }),
    };
  }
  if (!operation) return { status: 'NOT_FOUND' as const };
  if (operation.status === 'COMPENSATED') return { status: 'COMPENSATED' as const };
  if (['REQUIRES_RECONCILIATION', 'COMMITTED'].includes(operation.status)) {
    return { status: 'REQUIRES_RECONCILIATION' as const };
  }
  return { status: 'PROCESSING' as const };
}
