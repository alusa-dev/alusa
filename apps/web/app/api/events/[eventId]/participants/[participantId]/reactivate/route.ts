import { NextRequest, NextResponse } from 'next/server';

import { createStandaloneCharge } from '@alusa/finance';
import { prisma } from '@alusa/database';
import { reactivateEventParticipantRequestSchema, reactivateEventParticipantSchema } from '@alusa/lib/events/events.schema';
import {
  EventsError,
  getEventParticipantRemovalDecision,
  reactivateEventParticipant,
} from '@alusa/lib/events/events.service';

import { getEventsContext, handleEventsRouteError } from '../../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ eventId: string; participantId: string }> };

const billingErrorMap: Record<string, { status: number; message: string }> = {
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

function parseDueDate(value: string | undefined) {
  if (!value) return undefined;
  return new Date(`${value}T00:00:00.000`);
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { eventId, participantId } = await params;
    const ctx = await getEventsContext('events.update');
    const body = reactivateEventParticipantRequestSchema.parse(await request.json());

    const participant = await prisma.eventParticipant.findFirst({
      where: { id: participantId, eventId, contaId: ctx.contaId },
      include: { event: true },
    });
    if (!participant) {
      throw new EventsError('INSCRICAO_NAO_ENCONTRADA', 'Inscrição não encontrada.', 404);
    }
    if (!participant.cancelledAt) {
      throw new EventsError('PARTICIPANTE_NAO_CANCELADO', 'Somente inscrições canceladas podem ser reinscritas.', 409);
    }

    const decision = await getEventParticipantRemovalDecision(ctx, eventId, participantId);
    if (!decision.canRemove) {
      throw new EventsError(
        'PARTICIPANTE_REINSCRICAO_BLOQUEADA',
        'Este aluno possui histórico financeiro ou operacional neste evento. A reinscrição automática não está disponível para este caso.',
        409,
        { reasons: decision.reasons },
      );
    }

    const isFeePaid = body.billingMethod === 'MANUAL_RECEIVED';
    const feePaymentMethod = isFeePaid ? body.feePaymentMethod : body.billingMethod;
    let asaasPaymentId: string | null = null;

    if (body.registrationFeeCharged > 0 && !isFeePaid) {
      if (!participant.alunoId) {
        throw new EventsError('ALUNO_NAO_ENCONTRADO', 'Aluno não encontrado para gerar nova cobrança.', 404);
      }

      const billingResult = await createStandaloneCharge({
        contaId: ctx.contaId,
        actor: { type: 'USER', id: ctx.userId },
        payer: { type: 'aluno', alunoId: participant.alunoId },
        chargeType: body.chargeType || 'ONE_TIME',
        billingType: body.billingMethod as 'BOLETO' | 'PIX' | 'CREDIT_CARD',
        description: `Taxa de inscrição no evento - ${participant.event.name}`,
        value: body.registrationFeeCharged,
        dueDate: body.dueDate,
        installmentCount: body.installmentCount,
        installmentValue: body.chargeType === 'INSTALLMENT' && body.installmentCount
          ? Number((body.registrationFeeCharged / body.installmentCount).toFixed(2))
          : undefined,
      });

      if (!billingResult.success) {
        const errInfo = billingErrorMap[billingResult.error] ?? { status: 500, message: `Erro ao gerar cobrança: ${billingResult.error}` };
        return NextResponse.json({ error: { code: billingResult.error, message: errInfo.message } }, { status: errInfo.status });
      }

      asaasPaymentId = billingResult.data.asaasPaymentId || billingResult.data.asaasInstallmentId || null;
    }

    const input = reactivateEventParticipantSchema.parse({
      registrationFeeCharged: body.registrationFeeCharged,
      isFeePaid,
      feePaymentMethod: body.registrationFeeCharged > 0 ? feePaymentMethod : undefined,
      notes: body.notes,
      dueDate: parseDueDate(body.dueDate),
      paymentProvider: asaasPaymentId ? 'ASAAS' : null,
      asaasPaymentId,
      paymentStatus: asaasPaymentId ? 'PENDING' : null,
      billingMethod: body.billingMethod,
      chargeType: body.chargeType,
      installmentCount: body.installmentCount,
    });

    const result = await reactivateEventParticipant(ctx, eventId, participantId, input);
    return NextResponse.json({ data: result });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_REINSCREVER_PARTICIPANTE');
  }
}
