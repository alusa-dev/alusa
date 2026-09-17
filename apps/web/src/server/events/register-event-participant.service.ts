import { z } from 'zod';

import { createStandaloneCharge } from '@alusa/finance';
import {
  eventParticipantScalarSelect,
  registerEventParticipant,
  registerEventParticipantGroup,
  type EventsContext,
} from '@alusa/lib/events/events.service';
import { registerEventParticipantRequestSchema } from '@alusa/lib/events/events.schema';
import { calculateEventParticipantDiscount } from '@alusa/lib/events/event-participant-discount';
import {
  eventPaymentRulesFromRecord,
  eventPaymentRulesToAsaas,
  validateEventPaymentRulesForCharge,
} from '@alusa/lib/events/events-payment-rules';

import { eventParticipantRepository } from './event-participant.repository';

type RegisterEventParticipantInput = z.infer<typeof registerEventParticipantRequestSchema>;

export type EventParticipantRegistrationResult = {
  status: number;
  body: unknown;
  errorCode?: string;
  fields?: Record<string, unknown>;
};

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
  NOTIFICACOES_NAO_CONFIGURADAS: { status: 502, message: 'Não foi possível configurar as notificações. A cobrança não foi criada.' },
  RESPONSAVEL_OBRIGATORIO_MENOR: { status: 422, message: 'Aluno menor exige responsável financeiro vinculado' },
  ERRO_AO_CRIAR_PAGAMENTO: { status: 502, message: 'Erro ao criar pagamento no provedor' },
  COBRANCA_DUPLICADA: { status: 409, message: 'Cobrança duplicada' },
};

function parseDueDate(value?: string) {
  return value ? new Date(`${value}T00:00:00.000`) : null;
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002');
}

function billingFailure(error: string, participantCount?: number): EventParticipantRegistrationResult {
  const mapped = billingErrorMap[error] ?? {
    status: 502,
    message: 'Não foi possível criar a cobrança no provedor financeiro.',
  };
  return {
    status: mapped.status,
    body: { error: { code: error, message: mapped.message } },
    errorCode: error,
    ...(participantCount === undefined ? {} : { fields: { participantCount } }),
  };
}

async function rollbackParticipantGroup(
  contaId: string,
  groupId: string,
  participantIds: string[],
  entryIds: string[],
) {
  await eventParticipantRepository.$transaction(async (tx) => {
    await tx.eventoContrato.deleteMany({
      where: { contaId, participantId: { in: participantIds }, status: 'PENDENTE' },
    });
    if (entryIds.length > 0) {
      await tx.eventFinancialEntry.deleteMany({ where: { contaId, id: { in: entryIds } } });
    }
    await tx.eventParticipant.deleteMany({ where: { contaId, id: { in: participantIds } } });
    await tx.eventBillingGroup.deleteMany({ where: { contaId, id: groupId, status: 'PENDING' } });
  });
}

async function rollbackParticipant(contaId: string, participant: { id: string; revenueEntryId: string | null }) {
  await eventParticipantRepository.eventoContrato.deleteMany({
    where: { contaId, participantId: participant.id, status: 'PENDENTE' },
  });
  await eventParticipantRepository.eventParticipant.deleteMany({
    where: { id: participant.id, contaId },
  });
  if (participant.revenueEntryId) {
    await eventParticipantRepository.eventFinancialEntry.deleteMany({
      where: { id: participant.revenueEntryId, contaId },
    });
  }
}

export async function registerEventParticipantForHttp(input: {
  ctx: EventsContext;
  eventId: string;
  body: RegisterEventParticipantInput;
}): Promise<EventParticipantRegistrationResult> {
  const { ctx, eventId, body } = input;
  const event = await eventParticipantRepository.schoolEvent.findFirst({
    where: { id: eventId, contaId: ctx.contaId },
  });

  if (!event) {
    return {
      status: 404,
      body: { error: { code: 'EVENTO_NAO_ENCONTRADO', message: 'Evento não encontrado' } },
      errorCode: 'EVENTO_NAO_ENCONTRADO',
    };
  }

  const alunoIds = [...new Set([body.alunoId, ...(body.additionalAlunoIds ?? [])])];
  const discount = calculateEventParticipantDiscount({
    originalAmount: body.registrationFeeOriginal ?? body.registrationFeeCharged,
    discountType: body.discountType,
    discountValue: body.discountValue,
    quantity: alunoIds.length,
  });
  const registrationFeeCharged = discount.chargedAmount;
  const initialPaymentAmount = body.billingMethod === 'MANUAL_RECEIVED' ? body.initialPaymentAmount : 0;
  const effectiveRegistrationFeeCharged = body.isFeeExempt ? 0 : registrationFeeCharged;
  const entryAmount = body.hasEntry
    ? body.entryAmount
    : body.billingMethod === 'MANUAL_RECEIVED'
      ? initialPaymentAmount
      : 0;
  const feePaymentMethod = entryAmount > 0
    ? body.initialPaymentMethod ?? body.entryPaymentMethod ?? body.feePaymentMethod
    : body.billingMethod;
  const balanceAmount = Math.max(effectiveRegistrationFeeCharged - entryAmount, 0);
  const billingMode = body.hasEntry
    ? 'ENTRY_INSTALLMENT'
    : body.chargeType === 'INSTALLMENT'
      ? 'INSTALLMENT'
      : 'FULL';
  const paymentRules = eventPaymentRulesFromRecord(event);
  const totalRegistrationFee = Number(effectiveRegistrationFeeCharged.toFixed(2));
  const isFeePaid = body.billingMethod === 'MANUAL_RECEIVED'
    && totalRegistrationFee > 0
    && entryAmount >= totalRegistrationFee;

  if (alunoIds.length > 1) {
    if (!body.responsavelId) {
      return {
        status: 422,
        body: {
          error: {
            code: 'RESPONSAVEL_FINANCEIRO_OBRIGATORIO',
            message: 'Selecione o responsável financeiro para agrupar as inscrições.',
          },
        },
        errorCode: 'RESPONSAVEL_FINANCEIRO_OBRIGATORIO',
        fields: { participantCount: alunoIds.length },
      };
    }

    const groupPaymentRulesError = isFeePaid || body.billingMethod === 'MANUAL_RECEIVED'
      ? null
      : validateEventPaymentRulesForCharge(paymentRules, balanceAmount);
    if (groupPaymentRulesError) {
      return {
        status: 422,
        body: { error: { code: 'REGRAS_COBRANCA_INVALIDAS', message: groupPaymentRulesError } },
        errorCode: 'REGRAS_COBRANCA_INVALIDAS',
        fields: { participantCount: alunoIds.length },
      };
    }

    const groupResult = await registerEventParticipantGroup(ctx, {
      eventId,
      alunoId: body.alunoId,
      alunoIds,
      responsavelId: body.responsavelId,
      registrationFeeCharged: body.registrationFeeCharged,
      registrationFeeOriginal: body.registrationFeeOriginal,
      registrationFeeDiscount: body.discountValue,
      registrationFeeOriginalTotal: discount.originalAmount,
      registrationFeeDiscountTotal: discount.discountAmount,
      registrationFeeChargedTotal: effectiveRegistrationFeeCharged,
      registrationFeeDiscountType: discount.discountAmount > 0 ? body.discountType : null,
      billingMode,
      entryAmount,
      entryPaymentMethod: entryAmount > 0
        ? body.initialPaymentMethod ?? body.entryPaymentMethod ?? body.feePaymentMethod
        : null,
      initialPaymentAmount,
      initialPaymentMethod: body.initialPaymentMethod,
      billingMethod: body.billingMethod,
      isFeeExempt: body.isFeeExempt,
      isFeePaid,
      feePaymentMethod,
      notes: body.notes,
      chargeType: body.chargeType || 'ONE_TIME',
      installmentCount: body.installmentCount,
      dueDate: parseDueDate(body.dueDate),
      uiRequestId: body.uiRequestId,
    });

    if (groupResult.reused) {
      return {
        status: 200,
        body: { data: groupResult.participants[0] },
        fields: { participantCount: alunoIds.length, idempotentReplay: true },
      };
    }

    const groupBalanceAmount = Number(groupResult.group.balanceAmount);
    if (groupBalanceAmount > 0 && !isFeePaid && body.billingMethod !== 'MANUAL_RECEIVED') {
      try {
        const billingResult = await createStandaloneCharge({
          contaId: ctx.contaId,
          actor: { type: 'USER', id: ctx.userId },
          payer: { type: 'responsavel', responsavelId: body.responsavelId },
          chargeType: body.chargeType || 'ONE_TIME',
          billingType: body.billingMethod as 'BOLETO' | 'PIX' | 'CREDIT_CARD',
          description: body.hasEntry
            ? `Saldo da cobrança agrupada do evento - ${event.name}`
            : `Taxa de inscrição agrupada no evento - ${event.name}`,
          value: groupBalanceAmount,
          dueDate: body.dueDate,
          installmentCount: body.installmentCount,
          installmentValue: body.chargeType === 'INSTALLMENT' && body.installmentCount
            ? Number((groupBalanceAmount / body.installmentCount).toFixed(2))
            : undefined,
          notificationChannels: body.notificationChannels,
          notificationChannelsConfigured: body.notificationChannelsConfigured,
          uiRequestId: `event-billing-group:${groupResult.group.id}:balance`,
          ...eventPaymentRulesToAsaas(paymentRules),
        });

        if (!billingResult.success) {
          await rollbackParticipantGroup(
            ctx.contaId,
            groupResult.group.id,
            groupResult.participants.map((participant) => participant.id),
            groupResult.participants
              .map((participant) => participant.revenueEntryId)
              .filter((id): id is string => Boolean(id)),
          );
          return billingFailure(billingResult.error, alunoIds.length);
        }

        const updatedGroup = await eventParticipantRepository.eventBillingGroup.update({
          where: { id: groupResult.group.id, contaId: ctx.contaId },
          data: {
            status: 'OPEN',
            standaloneChargeId: billingResult.data.chargeId,
            asaasPaymentId: billingResult.data.asaasPaymentId ?? null,
            asaasInstallmentId: billingResult.data.asaasInstallmentId ?? null,
          },
        });
        await eventParticipantRepository.eventParticipant.updateMany({
          where: { contaId: ctx.contaId, id: { in: groupResult.participants.map((participant) => participant.id) } },
          data: {
            standaloneChargeId: updatedGroup.standaloneChargeId,
            asaasPaymentId: updatedGroup.asaasPaymentId,
            asaasInstallmentId: updatedGroup.asaasInstallmentId,
          },
        });
        await eventParticipantRepository.eventFinancialEntry.updateMany({
          where: {
            contaId: ctx.contaId,
            id: { in: groupResult.participants.map((participant) => participant.revenueEntryId).filter((id): id is string => Boolean(id)) },
          },
          data: { paymentProvider: 'ASAAS', paymentStatus: 'PENDING' },
        });
      } catch (billingError) {
        await eventParticipantRepository.eventBillingGroup.updateMany({
          where: { id: groupResult.group.id, contaId: ctx.contaId, status: 'PENDING' },
          data: { status: 'REQUIRES_RECONCILIATION' },
        });
        throw billingError;
      }
    } else if (body.billingMethod !== 'MANUAL_RECEIVED' || body.isFeeExempt) {
      await eventParticipantRepository.eventBillingGroup.update({
        where: { id: groupResult.group.id, contaId: ctx.contaId },
        data: { status: 'PAID' },
      });
    }

    const groupedParticipant = await eventParticipantRepository.eventParticipant.findFirst({
      where: { id: groupResult.participants[0].id, contaId: ctx.contaId },
      select: eventParticipantScalarSelect,
    });
    return {
      status: 201,
      body: { data: groupedParticipant ?? groupResult.participants[0] },
      fields: { participantCount: alunoIds.length },
    };
  }

  const paymentRulesError = isFeePaid || body.billingMethod === 'MANUAL_RECEIVED'
    ? null
    : validateEventPaymentRulesForCharge(paymentRules, balanceAmount);
  if (paymentRulesError) {
    return {
      status: 422,
      body: { error: { code: 'REGRAS_COBRANCA_INVALIDAS', message: paymentRulesError } },
      errorCode: 'REGRAS_COBRANCA_INVALIDAS',
    };
  }

  const participant = await registerEventParticipant(ctx, {
    eventId,
    alunoId: body.alunoId,
    responsavelId: body.responsavelId,
    registrationFeeCharged: effectiveRegistrationFeeCharged,
    registrationFeeOriginal: discount.originalAmount,
    registrationFeeDiscount: discount.discountAmount,
    registrationFeeDiscountType: discount.discountAmount > 0 ? body.discountType : null,
    billingMode,
    entryAmount,
    entryPaymentMethod: entryAmount > 0
      ? body.initialPaymentMethod ?? body.entryPaymentMethod ?? body.feePaymentMethod
      : null,
    initialPaymentAmount,
    initialPaymentMethod: body.initialPaymentMethod,
    billingMethod: body.billingMethod,
    isFeeExempt: body.isFeeExempt,
    isFeePaid,
    feePaymentMethod,
    notes: body.notes,
  });

  if (balanceAmount > 0 && !isFeePaid && body.billingMethod !== 'MANUAL_RECEIVED') {
    try {
      const billingResult = await createStandaloneCharge({
        contaId: ctx.contaId,
        actor: { type: 'USER', id: ctx.userId },
        payer: body.responsavelId
          ? { type: 'responsavel', responsavelId: body.responsavelId }
          : { type: 'aluno', alunoId: body.alunoId },
        chargeType: body.chargeType || 'ONE_TIME',
        billingType: body.billingMethod as 'BOLETO' | 'PIX' | 'CREDIT_CARD',
        description: body.hasEntry
          ? `Saldo da taxa de inscrição no evento - ${event.name}`
          : `Taxa de inscrição no evento - ${event.name}`,
        value: balanceAmount,
        dueDate: body.dueDate,
        installmentCount: body.installmentCount,
        installmentValue: body.chargeType === 'INSTALLMENT' && body.installmentCount
          ? Number((balanceAmount / body.installmentCount).toFixed(2))
          : undefined,
        notificationChannels: body.notificationChannels,
        notificationChannelsConfigured: body.notificationChannelsConfigured,
        uiRequestId: `event-participant:${participant.id}:balance`,
        ...eventPaymentRulesToAsaas(paymentRules),
      });

      if (!billingResult.success) {
        await rollbackParticipant(ctx.contaId, participant);
        return billingFailure(billingResult.error);
      }

      await eventParticipantRepository.eventParticipant.updateMany({
        where: { id: participant.id, contaId: ctx.contaId },
        data: {
          standaloneChargeId: billingResult.data.chargeId,
          asaasPaymentId: billingResult.data.asaasPaymentId ?? null,
          asaasInstallmentId: billingResult.data.asaasInstallmentId ?? null,
        },
      });
      if (participant.revenueEntryId) {
        await eventParticipantRepository.eventFinancialEntry.updateMany({
          where: { id: participant.revenueEntryId, contaId: ctx.contaId },
          data: {
            paymentProvider: 'ASAAS',
            paymentStatus: 'PENDING',
            asaasPaymentId: billingResult.data.asaasPaymentId ?? billingResult.data.asaasInstallmentId ?? null,
          },
        });
      }
    } catch (billingError) {
      await rollbackParticipant(ctx.contaId, participant);
      throw billingError;
    }
  }

  const createdParticipant = await eventParticipantRepository.eventParticipant.findFirst({
    where: { id: participant.id, contaId: ctx.contaId },
    select: eventParticipantScalarSelect,
  });
  return { status: 201, body: { data: createdParticipant ?? participant } };
}

export async function replayEventParticipantRegistration(input: {
  contaId: string;
  eventId: string;
  uiRequestId: string;
}): Promise<EventParticipantRegistrationResult | null> {
  const existingGroup = await eventParticipantRepository.eventBillingGroup.findFirst({
    where: { contaId: input.contaId, eventId: input.eventId, uiRequestId: input.uiRequestId },
    include: { participants: { select: eventParticipantScalarSelect } },
  });
  const participant = existingGroup?.participants[0];
  if (!participant) return null;
  return {
    status: 200,
    body: { data: participant },
    fields: { participantCount: existingGroup.participants.length, idempotentReplay: true },
  };
}

export { isUniqueConstraintError };
