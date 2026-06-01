import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createEventParticipantSchema } from '@alusa/lib/events/events.schema';
import { listEventParticipants, registerEventParticipant } from '@alusa/lib/events/events.service';
import { createStandaloneCharge } from '@alusa/finance';
import { prisma } from '@alusa/database';

import { getEventsContext, handleEventsRouteError } from '../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ eventId: string }> };

const registerParticipantBodySchema = z.object({
  alunoId: z.string().trim().min(1),
  registrationFeeCharged: z.coerce.number().optional().default(0),
  billingMethod: z.enum(['MANUAL_RECEIVED', 'BOLETO', 'PIX', 'CREDIT_CARD']).optional().default('MANUAL_RECEIVED'),
  feePaymentMethod: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  chargeType: z.enum(['ONE_TIME', 'INSTALLMENT']).optional(),
  installmentCount: z.coerce.number().int().min(2).max(24).optional(),
});

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { eventId } = await params;
    const ctx = await getEventsContext('events.view');
    const participants = await listEventParticipants(ctx, eventId);
    return NextResponse.json({ data: participants });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_LISTAR_PARTICIPANTES');
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { eventId } = await params;
    const ctx = await getEventsContext('events.update');
    const body = registerParticipantBodySchema.parse(await request.json());

    // 1. Verificar se o evento existe
    const event = await prisma.schoolEvent.findFirst({
      where: { id: eventId, contaId: ctx.contaId },
    });
    if (!event) {
      return NextResponse.json({ error: { code: 'EVENTO_NAO_ENCONTRADO', message: 'Evento não encontrado' } }, { status: 404 });
    }

    // 2. Registrar o participante localmente (isFeePaid é true se for manual/quitado na hora)
    const isFeePaid = body.billingMethod === 'MANUAL_RECEIVED';
    const feePaymentMethod = isFeePaid ? body.feePaymentMethod : body.billingMethod;

    const participant = await registerEventParticipant(ctx, {
      eventId,
      alunoId: body.alunoId,
      registrationFeeCharged: body.registrationFeeCharged,
      isFeePaid,
      feePaymentMethod,
      notes: body.notes,
    });

    // 3. Se houver taxa cobrada e for cobrança digital via Asaas, gera a cobrança externa
    if (body.registrationFeeCharged > 0 && !isFeePaid) {
      try {
        const billingResult = await createStandaloneCharge({
          contaId: ctx.contaId,
          actor: { type: 'USER', id: ctx.userId },
          payer: { type: 'aluno', alunoId: body.alunoId },
          chargeType: body.chargeType || 'ONE_TIME',
          billingType: body.billingMethod as 'BOLETO' | 'PIX' | 'CREDIT_CARD',
          description: `Taxa de inscrição no evento - ${event.name}`,
          value: body.registrationFeeCharged,
          dueDate: body.dueDate,
          installmentCount: body.installmentCount,
          installmentValue: body.chargeType === 'INSTALLMENT' && body.installmentCount
            ? Number((body.registrationFeeCharged / body.installmentCount).toFixed(2))
            : undefined,
        });

        if (!billingResult.success) {
          // Deleta participante criado (Rollback manual)
          await prisma.eventParticipant.delete({
            where: { id: participant.id },
          });
          if (participant.revenueEntryId) {
            await prisma.eventFinancialEntry.delete({
              where: { id: participant.revenueEntryId },
            });
          }

          const errorMap: Record<string, { status: number; message: string }> = {
            FEATURE_DISABLED: { status: 403, message: 'Funcionalidade financeira desabilitada para esta conta' },
            KYC_NAO_APROVADO: { status: 409, message: 'Conta financeira não aprovada' },
            PAGADOR_NAO_ENCONTRADO: { status: 404, message: 'Pagador não encontrado' },
            PAGADOR_SEM_CPF: { status: 422, message: 'Pagador sem CPF cadastrado' },
            CREDENCIAIS_ASAAS_NAO_CONFIGURADAS: { status: 503, message: 'Integração financeira não configurada' },
            CUSTOMER_SEM_ASAAS_ID: { status: 409, message: 'Cadastro financeiro do pagador incompleto' },
            FORMA_PAGAMENTO_INVALIDA: { status: 422, message: 'Forma de pagamento inválida' },
            VALOR_INVALIDO: { status: 422, message: 'Valor inválido' },
            DATA_INVALIDA: { status: 422, message: 'Data inválida' },
            PARCELAS_INVALIDAS: { status: 422, message: 'Número de parcelas inválido (mínimo 2)' },
            RESPONSAVEL_OBRIGATORIO_MENOR: { status: 422, message: 'Aluno menor exige responsável financeiro vinculado' },
            ERRO_AO_CRIAR_PAGAMENTO: { status: 502, message: 'Erro ao criar pagamento no provedor' },
            COBRANCA_DUPLICADA: { status: 409, message: 'Cobrança duplicada' },
          };

          const errInfo = errorMap[billingResult.error] ?? { status: 500, message: `Erro ao gerar cobrança: ${billingResult.error}` };
          return NextResponse.json({ error: { code: billingResult.error, message: errInfo.message } }, { status: errInfo.status });
        }

        // Vincular o ID de pagamento gerado na nossa entrada financeira
        if (participant.revenueEntryId) {
          await prisma.eventFinancialEntry.update({
            where: { id: participant.revenueEntryId },
            data: {
              asaasPaymentId: billingResult.data.asaasPaymentId || billingResult.data.asaasInstallmentId || undefined,
              paymentProvider: 'ASAAS',
              paymentStatus: 'PENDING',
            },
          });
        }
      } catch (billingError) {
        // Rollback caso ocorra exceção
        await prisma.eventParticipant.delete({
          where: { id: participant.id },
        });
        if (participant.revenueEntryId) {
          await prisma.eventFinancialEntry.delete({
            where: { id: participant.revenueEntryId },
          });
        }
        throw billingError;
      }
    }

    return NextResponse.json({ data: participant }, { status: 201 });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_REGISTRAR_PARTICIPANTE');
  }
}
