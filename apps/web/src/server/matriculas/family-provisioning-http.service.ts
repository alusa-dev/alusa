import { prisma } from '@/src/prisma';
import { processFamilyBillingOutboxEvent, reconcileFailedFamilyEnrollmentOutbox } from '@alusa/finance/family-billing/processor';

function derivePaymentStatus(charges: Array<{ status: string; dueDate: Date | null }>) {
  if (charges.length === 0) return 'SEM_COBRANCA';
  if (charges.some((charge) => charge.status === 'OVERDUE')) return 'INADIMPLENTE';
  if (charges.every((charge) => charge.status === 'PAID')) return 'ADIMPLENTE';
  if (charges.some((charge) => charge.status === 'REFUNDED')) return 'ESTORNADO';
  if (charges.some((charge) => charge.status === 'PAID')) return 'PARCIALMENTE_PAGO';
  return charges.every((charge) => charge.dueDate && charge.dueDate > new Date()) ? 'A_VENCER' : 'PENDENTE';
}

export async function getFamilyProvisioningView(input: { familyId: string; contaId: string }) {
  const family = await prisma.matriculaFamiliar.findFirst({
    where: { id: input.familyId, contaId: input.contaId },
    include: {
      items: { orderBy: { orderIndex: 'asc' }, include: { matricula: { select: { id: true, status: true, taxaStatus: true, statusFinanceiro: true, billingProvisionStatus: true, aluno: { select: { id: true, nome: true } }, contratoAtual: { select: { id: true, status: true } } } } } },
      enrollmentOperations: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, status: true, lastError: true, result: true, updatedAt: true } },
    },
  });
  if (!family) return null;
  const operation = family.enrollmentOperations[0] ?? null;
  const allocations = operation ? await prisma.familyFinancialAllocation.findMany({ where: { contaId: input.contaId, familyGroupId: family.id, familyEnrollmentOperationId: operation.id }, select: { sourceChargeId: true } }) : [];
  const chargeIds = Array.from(new Set(allocations.flatMap((item) => item.sourceChargeId ? [item.sourceChargeId] : [])));
  const charges = await prisma.charge.findMany({ where: { contaId: input.contaId, id: { in: chargeIds } }, select: { id: true, status: true, dueDate: true } });
  const storedResult = operation?.result && typeof operation.result === 'object' && !Array.isArray(operation.result) ? operation.result as Record<string, unknown> : null;
  const storedItems = Array.isArray(storedResult?.results) ? storedResult.results as Array<Record<string, unknown>> : [];
  const liveItems = family.items.map((item) => ({
    alunoId: item.matricula.aluno.id, alunoNome: item.matricula.aluno.nome, status: 'success' as const,
    matriculaId: item.matricula.id, contratoId: item.matricula.contratoAtual?.id ?? undefined,
    academic: { status: item.matricula.status, matriculaId: item.matricula.id },
    contract: item.matricula.contratoAtual ? { status: item.matricula.contratoAtual.status, contratoId: item.matricula.contratoAtual.id } : { status: 'FAILED', contratoId: null },
    finance: { taxaStatus: item.matricula.taxaStatus, status: item.matricula.statusFinanceiro, provisionStatus: item.matricula.billingProvisionStatus },
  }));
  const liveByStudent = new Map(liveItems.map((item) => [item.alunoId, item]));
  const results = [...storedItems.map((item) => liveByStudent.get(String(item.alunoId)) ?? item), ...liveItems.filter((item) => !storedItems.some((stored) => String(stored.alunoId) === item.alunoId))];
  const operationInProgress = operation?.status === 'PENDING' || operation?.status === 'PROCESSING';
  return {
    familyId: family.id, academicStatus: family.academicStatus,
    billingProvisionStatus: operationInProgress ? 'PROCESSANDO' : family.billingProvisionStatus,
    paymentStatus: charges.length > 0 ? derivePaymentStatus(charges) : family.billingProvisionStatus === 'PROVISIONADO' ? 'A_VENCER' : 'PENDENTE',
    financialError: family.ultimoErro ? 'O provisionamento financeiro requer atenção. Atualize o status ou acione o suporte.' : null,
    operationStatus: operation?.status,
    operation: operation ? { id: operation.id, status: operation.status, updatedAt: operation.updatedAt } : null,
    results,
  };
}

export async function retryFamilyProvisioning(input: { familyId: string; contaId: string }) {
  const family = await prisma.matriculaFamiliar.findFirst({ where: { id: input.familyId, contaId: input.contaId }, select: { id: true, items: { select: { id: true } }, enrollmentOperations: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true } } } });
  if (!family) return { ok: false as const, status: 404, message: 'Matrícula familiar não encontrada.' };
  const event = await prisma.familyBillingOutbox.findFirst({ where: { contaId: input.contaId, matriculaFamiliarId: family.id, status: { in: ['PENDING', 'FAILED', 'REQUIRES_RECONCILIATION'] } }, orderBy: { createdAt: 'desc' }, select: { id: true } });
  if (!event) return { ok: false as const, status: 409, message: 'Nenhum provisionamento financeiro pendente foi encontrado.' };
  const latest = family.enrollmentOperations[0];
  const result = latest?.status === 'REQUIRES_RECONCILIATION' && family.items.length === 0
    ? await reconcileFailedFamilyEnrollmentOutbox(event.id)
    : await processFamilyBillingOutboxEvent(event.id, { allowReconciliation: true });
  return { ok: true as const, result };
}
