import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionUser } from '@/lib/auth/session';
import { getPayment, updatePayment } from '@alusa/finance';

import { prisma } from '@/src/prisma';

const inputSchema = z.object({ value: z.number().positive().max(10_000) }).strict();
const allowedRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);

function error(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return error(401, 'NAO_AUTENTICADO', 'Usuário não autenticado.');
  if (!allowedRoles.has(String(user.role).toUpperCase())) {
    return error(403, 'PERMISSAO_NEGADA', 'Usuário sem permissão para alterar taxas.');
  }
  const parsed = inputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return error(400, 'PAYLOAD_INVALIDO', parsed.error.issues[0]?.message ?? 'Valor inválido.');
  const { id: matriculaId } = await context.params;

  const allocation = await prisma.billingAllocation.findFirst({
    where: {
      contaId: user.contaId,
      matriculaId,
      kind: 'ENROLLMENT_FEE',
      status: { in: ['ACTIVE', 'SCHEDULED'] },
    },
    orderBy: { createdAt: 'desc' },
    include: {
      sourceCharge: { include: { cobranca: true } },
      agreement: true,
    },
  });
  if (!allocation) return error(404, 'TAXA_NAO_MATERIALIZADA', 'Taxa financeira não encontrada para esta matrícula.');

  const sourceCharge = allocation.sourceCharge;
  const paymentId = sourceCharge?.asaasPaymentId ?? sourceCharge?.cobranca?.asaasPaymentId ?? null;
  if (!paymentId) return error(409, 'TAXA_SEM_PAYMENT', 'A taxa ainda não possui cobrança confirmada no Asaas.');
  const remote = await getPayment(paymentId, { contaId: user.contaId });
  if (!['PENDING', 'OVERDUE'].includes(String(remote.status))) {
    return error(
      409,
      'TAXA_IMUTAVEL',
      'Somente taxas pendentes ou vencidas podem ter o valor alterado. Pagamentos confirmados exigem crédito ou reembolso.',
    );
  }

  const siblings = sourceCharge
    ? await prisma.billingAllocation.findMany({
        where: {
          contaId: user.contaId,
          sourceChargeId: sourceCharge.id,
          kind: 'ENROLLMENT_FEE',
          status: { in: ['ACTIVE', 'SCHEDULED'] },
        },
        select: { id: true, matriculaId: true, netAmount: true },
      })
    : [{ id: allocation.id, matriculaId: allocation.matriculaId, netAmount: allocation.netAmount }];
  const affectedMatriculaIds = Array.from(
    new Set(
      [matriculaId, ...siblings.map((item) => item.matriculaId)].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  );
  const resultingValue = siblings.reduce(
    (sum, item) => sum + (item.id === allocation.id ? parsed.data.value : Number(item.netAmount)),
    0,
  );
  const updated = await updatePayment(
    paymentId,
    {
      value: Number(resultingValue.toFixed(2)),
      billingType: remote.billingType,
      dueDate: remote.dueDate,
    },
    { contaId: user.contaId },
  );
  if (Number(updated.value) !== Number(resultingValue.toFixed(2))) {
    return error(502, 'TAXA_NAO_CONFIRMADA', 'O Asaas não confirmou o novo valor da taxa.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.billingAllocation.updateMany({
      where: { id: allocation.id, contaId: user.contaId },
      data: { baseAmount: parsed.data.value, discountAmount: 0, netAmount: parsed.data.value },
    });
    await tx.familyFinancialAllocation.updateMany({
      where: { contaId: user.contaId, billingAllocationId: allocation.id },
      data: { amount: parsed.data.value, baseAmount: parsed.data.value, discountAmount: 0 },
    });
    if (sourceCharge) {
      await tx.charge.updateMany({
        where: { id: sourceCharge.id, contaId: user.contaId },
        data: { value: resultingValue, asaasValue: resultingValue },
      });
      if (sourceCharge.cobrancaId) {
        await tx.cobranca.updateMany({
          where: { id: sourceCharge.cobrancaId, contaId: user.contaId },
          data: { valor: resultingValue, asaasValue: resultingValue },
        });
      }
    }
    await tx.matricula.updateMany({
      where: { id: { in: affectedMatriculaIds }, contaId: user.contaId },
      data: { taxaMatricula: resultingValue },
    });
    await tx.matriculaLog.create({
      data: {
        matriculaId,
        actorId: user.id,
        action: 'MATRICULA_ENROLLMENT_FEE_VALUE_UPDATED',
        metadata: {
          billingAgreementId: allocation.agreementId,
          billingAllocationId: allocation.id,
          asaasPaymentId: paymentId,
          previousAllocationValue: Number(allocation.netAmount),
          nextAllocationValue: parsed.data.value,
          resultingChargeValue: resultingValue,
        },
      },
    });
  });

  return NextResponse.json({
    success: true,
    value: parsed.data.value,
    resultingChargeValue: resultingValue,
    message: 'Taxa atualizada e confirmada no Asaas.',
  });
}
