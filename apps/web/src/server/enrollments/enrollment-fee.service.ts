import { prisma } from '@/src/prisma';
import { getPayment, updatePayment } from '@alusa/finance';

export type MatriculaFeeUpdateResult =
  | { ok: false; status: number; code: string; message: string }
  | { ok: true; value: number; resultingChargeValue: number };

export async function updateMatriculaEnrollmentFee(input: {
  matriculaId: string;
  contaId: string;
  actorUserId: string;
  value: number;
}): Promise<MatriculaFeeUpdateResult> {
  const allocation = await prisma.billingAllocation.findFirst({
    where: { contaId: input.contaId, matriculaId: input.matriculaId, kind: 'ENROLLMENT_FEE', status: { in: ['ACTIVE', 'SCHEDULED'] } },
    orderBy: { createdAt: 'desc' },
    include: { sourceCharge: { include: { cobranca: true } }, agreement: true },
  });
  if (!allocation) return { ok: false, status: 404, code: 'TAXA_NAO_MATERIALIZADA', message: 'Taxa financeira não encontrada para esta matrícula.' };
  const sourceCharge = allocation.sourceCharge;
  const paymentId = sourceCharge?.asaasPaymentId ?? sourceCharge?.cobranca?.asaasPaymentId ?? null;
  if (!paymentId) return { ok: false, status: 409, code: 'TAXA_SEM_PAYMENT', message: 'A taxa ainda não possui cobrança confirmada no Asaas.' };
  const remote = await getPayment(paymentId, { contaId: input.contaId });
  if (!['PENDING', 'OVERDUE'].includes(String(remote.status))) return { ok: false, status: 409, code: 'TAXA_IMUTAVEL', message: 'Somente taxas pendentes ou vencidas podem ter o valor alterado. Pagamentos confirmados exigem crédito ou reembolso.' };
  const siblings = sourceCharge
    ? await prisma.billingAllocation.findMany({ where: { contaId: input.contaId, sourceChargeId: sourceCharge.id, kind: 'ENROLLMENT_FEE', status: { in: ['ACTIVE', 'SCHEDULED'] } }, select: { id: true, matriculaId: true, netAmount: true } })
    : [{ id: allocation.id, matriculaId: allocation.matriculaId, netAmount: allocation.netAmount }];
  const affectedMatriculaIds = Array.from(new Set([input.matriculaId, ...siblings.map((item) => item.matriculaId)].filter((value): value is string => Boolean(value))));
  const resultingValue = siblings.reduce((sum, item) => sum + (item.id === allocation.id ? input.value : Number(item.netAmount)), 0);
  const updated = await updatePayment(paymentId, { value: Number(resultingValue.toFixed(2)), billingType: remote.billingType, dueDate: remote.dueDate }, { contaId: input.contaId });
  if (Number(updated.value) !== Number(resultingValue.toFixed(2))) return { ok: false, status: 502, code: 'TAXA_NAO_CONFIRMADA', message: 'O Asaas não confirmou o novo valor da taxa.' };

  await prisma.$transaction(async (tx) => {
    await tx.billingAllocation.updateMany({ where: { id: allocation.id, contaId: input.contaId }, data: { baseAmount: input.value, discountAmount: 0, netAmount: input.value } });
    await tx.familyFinancialAllocation.updateMany({ where: { contaId: input.contaId, billingAllocationId: allocation.id }, data: { amount: input.value, baseAmount: input.value, discountAmount: 0 } });
    if (sourceCharge) {
      await tx.charge.updateMany({ where: { id: sourceCharge.id, contaId: input.contaId }, data: { value: resultingValue, asaasValue: resultingValue } });
      if (sourceCharge.cobrancaId) await tx.cobranca.updateMany({ where: { id: sourceCharge.cobrancaId, contaId: input.contaId }, data: { valor: resultingValue, asaasValue: resultingValue } });
    }
    await tx.matricula.updateMany({ where: { id: { in: affectedMatriculaIds }, contaId: input.contaId }, data: { taxaMatricula: resultingValue } });
    await tx.matriculaLog.create({ data: { matriculaId: input.matriculaId, actorId: input.actorUserId, action: 'MATRICULA_ENROLLMENT_FEE_VALUE_UPDATED', metadata: { billingAgreementId: allocation.agreementId, billingAllocationId: allocation.id, asaasPaymentId: paymentId, previousAllocationValue: Number(allocation.netAmount), nextAllocationValue: input.value, resultingChargeValue: resultingValue } } });
  });
  return { ok: true, value: input.value, resultingChargeValue: resultingValue };
}
