import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/src/prisma';
import { deletePayment, handlePaymentWebhook, readPaymentFullPreflight, syncPaymentStateFromAsaas } from '@alusa/finance';
import { financeiroCobrancaCancelResultDTOSchema } from '@/features/financeiro/cobrancas/dtos';
import { mapFinanceiroCobrancaCancelResultToDTO } from '@/features/financeiro/cobrancas/mappers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function err(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function buildDeletedPaymentWebhookPayload(
  payment: Awaited<ReturnType<typeof deletePayment>>,
) {
  return {
    event: 'PAYMENT_DELETED',
    payment: {
      id: payment.id,
      status: payment.status,
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

/**
 * DELETE /api/financeiro/cobrancas/[id]
 * Cancela uma cobrança e, se tiver asaasPaymentId, também cancela no Asaas
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    type SessUser = { id?: string; contaId?: string; role?: string };
    const user = (session as { user?: SessUser } | null)?.user;
    if (!user?.id || !user?.contaId) return err(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    if (!user.role || !allowedRoles.has(user.role.toUpperCase()))
      return err(403, 'SEM_PERMISSAO', 'Acesso negado');

    const { id } = await params;

    // Buscar cobrança
    const cobranca = await prisma.cobranca.findFirst({
      where: { id, matricula: { aluno: { contaId: user.contaId } } },
      include: { matricula: { include: { aluno: { include: { conta: true } } } } },
    });

    if (!cobranca) return err(404, 'COBRANCA_NAO_ENCONTRADA', 'Cobrança não encontrada');

    if (cobranca.status === 'CANCELADO') {
      return NextResponse.json(
        financeiroCobrancaCancelResultDTOSchema.parse(mapFinanceiroCobrancaCancelResultToDTO({
          success: true,
          message: 'Cobrança já está cancelada',
        })),
        { headers: { 'cache-control': 'no-store' } },
      );
    }

    const statusBloqueados = ['PAGO', 'ESTORNADO', 'ESTORNADO_PARCIAL'];
    if (statusBloqueados.includes(cobranca.status)) {
      return err(
        400,
        'STATUS_BLOQUEADO',
        `Não é possível cancelar cobrança com status ${cobranca.status}.`,
      );
    }

    let localStateConverged = false;

    // Se tiver asaasPaymentId, tentar cancelar no Asaas
    if (cobranca.asaasPaymentId) {
      try {
        const currentPayment = await readPaymentFullPreflight(cobranca.asaasPaymentId, {
          contaId: user.contaId,
        }).catch(() => null);

        if (currentPayment?.deleted === true || currentPayment?.status === 'DELETED') {
          const webhookResult = await handlePaymentWebhook(
            user.contaId,
            buildDeletedPaymentWebhookPayload(currentPayment as Awaited<ReturnType<typeof deletePayment>>),
          );
          localStateConverged = webhookResult.success;
        } else {
          const deletedPayment = await deletePayment(cobranca.asaasPaymentId, { contaId: user.contaId });
          const webhookResult = await handlePaymentWebhook(
            user.contaId,
            buildDeletedPaymentWebhookPayload(deletedPayment),
          );
          localStateConverged = webhookResult.success;
        }
      } catch (asaasError) {
        console.warn('[CANCEL Cobrança] Erro ao cancelar no Asaas:', asaasError);
        await syncPaymentStateFromAsaas({
          contaId: user.contaId,
          asaasPaymentId: cobranca.asaasPaymentId,
          eventName: 'PAYMENT_DELETED',
        }).catch((syncError) => {
          console.warn('[CANCEL Cobrança] Falha ao sincronizar estado local:', syncError);
        });
      }
    }

    await prisma.cobranca.update({
      where: { id },
      data: {
        status: localStateConverged ? 'CANCELADO' : 'CANCELAMENTO_PENDENTE',
        canceladoEm: new Date(),
        canceladoMotivo: 'Cancelada via API financeiro',
        canceladoPor: user.id,
      },
    });

    await prisma.logFinanceiro.create({
      data: {
        contaId: user.contaId,
        usuarioId: user.id,
        cobrancaId: id,
        acao: 'CANCELAR',
        detalhes: {
          asaasPaymentId: cobranca.asaasPaymentId,
          valor: cobranca.valor.toString(),
          statusAnterior: cobranca.status,
        },
      },
    });

    return NextResponse.json(
      financeiroCobrancaCancelResultDTOSchema.parse(mapFinanceiroCobrancaCancelResultToDTO({
        success: true,
        message: localStateConverged
          ? 'Cobrança cancelada com sucesso'
          : 'Solicitação enviada. O status será atualizado automaticamente.',
      })),
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    console.error('[API DELETE Cobrança] Erro', e);
    return err(500, 'ERRO_INTERNO', (e as Error).message);
  }
}
