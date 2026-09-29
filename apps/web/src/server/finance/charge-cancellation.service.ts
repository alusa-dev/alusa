import { prisma } from '@/lib/prisma';
import {
  deletePayment,
  handlePaymentWebhook,
  readPaymentFullPreflight,
  syncPaymentStateFromAsaas,
} from '@alusa/finance';

function buildDeletedPaymentWebhookPayload(
  payment: Awaited<ReturnType<typeof deletePayment>>,
) {
  return {
    event: 'PAYMENT_DELETED',
    payment: {
      id: payment.id,
      status: 'DELETED',
      value: Number(payment.value ?? 0),
      netValue: Number(payment.netValue ?? payment.value ?? 0),
      originalValue: payment.originalValue ?? null,
      externalReference: payment.externalReference ?? undefined,
      subscription: payment.subscription ?? null,
      installment: payment.installment ?? null,
      installmentNumber: null,
      dueDate: payment.dueDate ?? null,
      paymentDate: payment.paymentDate ?? null,
      clientPaymentDate: payment.clientPaymentDate ?? null,
      creditDate: payment.creditDate ?? null,
      estimatedCreditDate: payment.estimatedCreditDate ?? null,
      billingType: payment.billingType ?? null,
      deleted: payment.deleted ?? true,
    },
  } as const;
}

async function convergeLocalCanceledAcademicCharge(input: {
  contaId: string;
  cobrancaId: string;
  asaasPaymentId?: string | null;
  actorId: string;
}) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.cobranca.updateMany({
      where: {
        id: input.cobrancaId,
        contaId: input.contaId,
        status: { notIn: ['CANCELADO', 'PAGO', 'ESTORNADO', 'ESTORNADO_PARCIAL'] },
      },
      data: {
        status: 'CANCELADO',
        asaasStatus: 'DELETED',
        canceladoEm: now,
        canceladoMotivo: 'Cancelada no Asaas',
        canceladoPor: input.actorId,
        liquidacaoStatus: 'NAO_APLICAVEL',
      },
    });
    await tx.charge.updateMany({
      where: {
        contaId: input.contaId,
        OR: [
          { cobrancaId: input.cobrancaId },
          ...(input.asaasPaymentId ? [{ asaasPaymentId: input.asaasPaymentId }] : []),
        ],
        status: { notIn: ['CANCELED', 'PAID', 'REFUNDED'] },
      },
      data: {
        status: 'CANCELED',
        statusUpdatedAt: now,
        asaasStatus: 'DELETED',
        liquidacaoStatus: 'NAO_APLICAVEL',
      },
    });
  });
}

export async function cancelAcademicCobranca(input: {
  contaId: string;
  cobrancaId: string;
  actorId: string;
}) {
  const cobranca = await prisma.cobranca.findFirst({
    where: { id: input.cobrancaId, matricula: { aluno: { contaId: input.contaId } } },
    include: { matricula: { include: { aluno: { include: { conta: true } } } } },
  });

  if (!cobranca) return { status: 'NOT_FOUND' as const };
  if (cobranca.status === 'CANCELADO') return { status: 'ALREADY_CANCELED' as const };

  const blockedStatuses = ['PAGO', 'ESTORNADO', 'ESTORNADO_PARCIAL'];
  if (blockedStatuses.includes(cobranca.status)) {
    return { status: 'STATUS_BLOCKED' as const, cobrancaStatus: cobranca.status };
  }

  let localStateConverged = false;
  if (cobranca.asaasPaymentId) {
    try {
      const currentPayment = await readPaymentFullPreflight(cobranca.asaasPaymentId, {
        contaId: input.contaId,
      }).catch(() => null);
      const payment = currentPayment?.deleted === true || currentPayment?.status === 'DELETED'
        ? currentPayment
        : await deletePayment(cobranca.asaasPaymentId, { contaId: input.contaId });
      const webhookResult = await handlePaymentWebhook(
        input.contaId,
        buildDeletedPaymentWebhookPayload(payment as Awaited<ReturnType<typeof deletePayment>>),
      );
      localStateConverged = webhookResult.success;
      await convergeLocalCanceledAcademicCharge({
        contaId: input.contaId,
        cobrancaId: cobranca.id,
        asaasPaymentId: cobranca.asaasPaymentId,
        actorId: input.actorId,
      });
      localStateConverged = true;
    } catch (error) {
      console.warn('[cobranca-cancellation] Falha ao cancelar no Asaas', error);
      await syncPaymentStateFromAsaas({
        contaId: input.contaId,
        asaasPaymentId: cobranca.asaasPaymentId,
        eventName: 'PAYMENT_DELETED',
      }).catch((syncError) => {
        console.warn('[cobranca-cancellation] Falha ao sincronizar estado local', syncError);
      });
    }
  }

  if (!localStateConverged) {
    await prisma.cobranca.updateMany({
      where: { id: input.cobrancaId, contaId: input.contaId },
      data: {
        status: 'CANCELAMENTO_PENDENTE',
        canceladoEm: new Date(),
        canceladoMotivo: 'Cancelada via API financeiro',
        canceladoPor: input.actorId,
      },
    });
  }

  await prisma.logFinanceiro.create({
    data: {
      contaId: input.contaId,
      usuarioId: input.actorId,
      cobrancaId: input.cobrancaId,
      acao: 'CANCELAR',
      detalhes: {
        asaasPaymentId: cobranca.asaasPaymentId,
        valor: cobranca.valor.toString(),
        statusAnterior: cobranca.status,
      },
    },
  });

  return { status: localStateConverged ? ('CANCELED' as const) : ('PENDING' as const) };
}
