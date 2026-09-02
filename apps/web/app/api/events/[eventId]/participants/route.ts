import { NextRequest, NextResponse } from 'next/server';

import { registerEventParticipantRequestSchema } from '@alusa/lib/events/events.schema';
import {
  eventParticipantScalarSelect,
  listEventParticipants,
  registerEventParticipant,
  registerEventParticipantGroup,
} from '@alusa/lib/events/events.service';
import { calculateEventParticipantDiscount } from '@alusa/lib/events/event-participant-discount';
import {
  eventPaymentRulesFromRecord,
  eventPaymentRulesToAsaas,
  validateEventPaymentRulesForCharge,
} from '@alusa/lib/events/events-payment-rules';
import { createStandaloneCharge } from '@alusa/finance';
import { prisma } from '@alusa/database';

import { getRequestId, logApiResponse } from '@/lib/observability/api-logger';
import { getEventsContext, handleEventsRouteError } from '../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ eventId: string }> };

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

async function rollbackParticipantGroup(contaId: string, groupId: string, participantIds: string[], entryIds: string[]) {
  await prisma.$transaction(async (tx) => {
    await tx.eventoContrato.deleteMany({ where: { contaId, participantId: { in: participantIds }, status: 'PENDENTE' } });
    if (entryIds.length > 0) await tx.eventFinancialEntry.deleteMany({ where: { contaId, id: { in: entryIds } } });
    await tx.eventParticipant.deleteMany({ where: { contaId, id: { in: participantIds } } });
    await tx.eventBillingGroup.deleteMany({ where: { contaId, id: groupId, status: 'PENDING' } });
  });
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { eventId } = await params;
    const ctx = await getEventsContext('events.view');
    const participants = await listEventParticipants(ctx, eventId);
    return NextResponse.json({
      data: participants.map((participant) => ({
        ...participant,
        canPermanentlyDelete: ctx.role === 'ADMIN',
      })),
    });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_LISTAR_PARTICIPANTES');
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const route = '/api/events/[eventId]/participants';
  const requestId = getRequestId(request);
  const startedAt = Date.now();
  let eventIdForLog: string | undefined;
  let tenantId: string | undefined;
  let uiRequestId: string | undefined;
  const complete = (response: Response, errorCode?: string, fields?: Record<string, unknown>) => {
    logApiResponse({
      route,
      requestId,
      method: 'POST',
      startedAt,
      status: response.status,
      errorCode,
      tenantId,
      resourceId: eventIdForLog,
      ...fields,
    });
    return response;
  };

  try {
    const { eventId } = await params;
    eventIdForLog = eventId;
    const ctx = await getEventsContext('events.update');
    tenantId = ctx.contaId;
    const body = registerEventParticipantRequestSchema.parse(await request.json());
    uiRequestId = body.uiRequestId;

    // 1. Verificar se o evento existe
    const event = await prisma.schoolEvent.findFirst({
      where: { id: eventId, contaId: ctx.contaId },
    });
    if (!event) {
      return complete(NextResponse.json({ error: { code: 'EVENTO_NAO_ENCONTRADO', message: 'Evento não encontrado' } }, { status: 404 }), 'EVENTO_NAO_ENCONTRADO');
    }

    // 2. Registrar o participante localmente. A taxa pode ser paga na hora
    // ou gerar uma cobrança externa, inclusive para grupos.
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
    const entryAmount = body.hasEntry ? body.entryAmount : body.billingMethod === 'MANUAL_RECEIVED' ? initialPaymentAmount : 0;
    const feePaymentMethod = entryAmount > 0
      ? body.initialPaymentMethod ?? body.entryPaymentMethod ?? body.feePaymentMethod
      : body.hasEntry ? body.billingMethod : body.billingMethod;
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
        return complete(NextResponse.json(
          { error: { code: 'RESPONSAVEL_FINANCEIRO_OBRIGATORIO', message: 'Selecione o responsável financeiro para agrupar as inscrições.' } },
          { status: 422 },
        ), 'RESPONSAVEL_FINANCEIRO_OBRIGATORIO', { participantCount: alunoIds.length });
      }

      const groupedBalanceBeforeCreate = balanceAmount;
      const groupPaymentRulesError = isFeePaid || body.billingMethod === 'MANUAL_RECEIVED'
        ? null
        : validateEventPaymentRulesForCharge(paymentRules, groupedBalanceBeforeCreate);
      if (groupPaymentRulesError) {
        return complete(NextResponse.json(
          { error: { code: 'REGRAS_COBRANCA_INVALIDAS', message: groupPaymentRulesError } },
          { status: 422 },
        ), 'REGRAS_COBRANCA_INVALIDAS', { participantCount: alunoIds.length });
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
        entryPaymentMethod: entryAmount > 0 ? body.initialPaymentMethod ?? body.entryPaymentMethod ?? body.feePaymentMethod : null,
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
        return complete(NextResponse.json({ data: groupResult.participants[0] }, { status: 200 }), undefined, {
          participantCount: alunoIds.length,
          idempotentReplay: true,
        });
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
              groupResult.participants.map((participant) => participant.revenueEntryId).filter((id): id is string => Boolean(id)),
            );
            const errInfo = billingErrorMap[billingResult.error] ?? { status: 500, message: `Erro ao gerar cobrança: ${billingResult.error}` };
            return complete(NextResponse.json({ error: { code: billingResult.error, message: errInfo.message } }, { status: errInfo.status }), billingResult.error, {
              participantCount: alunoIds.length,
            });
          }

          const updatedGroup = await prisma.eventBillingGroup.update({
            where: { id: groupResult.group.id, contaId: ctx.contaId },
            data: {
              status: 'OPEN',
              standaloneChargeId: billingResult.data.chargeId,
              asaasPaymentId: billingResult.data.asaasPaymentId ?? null,
              asaasInstallmentId: billingResult.data.asaasInstallmentId ?? null,
            },
          });
          await prisma.eventParticipant.updateMany({
            where: { contaId: ctx.contaId, id: { in: groupResult.participants.map((participant) => participant.id) } },
            data: {
              standaloneChargeId: updatedGroup.standaloneChargeId,
              asaasPaymentId: updatedGroup.asaasPaymentId,
              asaasInstallmentId: updatedGroup.asaasInstallmentId,
            },
          });
          await prisma.eventFinancialEntry.updateMany({
            where: {
              contaId: ctx.contaId,
              id: { in: groupResult.participants.map((participant) => participant.revenueEntryId).filter((id): id is string => Boolean(id)) },
            },
            data: {
              paymentProvider: 'ASAAS',
              paymentStatus: 'PENDING',
            },
          });
        } catch (billingError) {
          await prisma.eventBillingGroup.updateMany({
            where: { id: groupResult.group.id, contaId: ctx.contaId, status: 'PENDING' },
            data: { status: 'REQUIRES_RECONCILIATION' },
          });
          throw billingError;
        }
      } else if (body.billingMethod !== 'MANUAL_RECEIVED' || body.isFeeExempt) {
        await prisma.eventBillingGroup.update({ where: { id: groupResult.group.id, contaId: ctx.contaId }, data: { status: 'PAID' } });
      }

      const groupedParticipant = await prisma.eventParticipant.findFirst({
        where: { id: groupResult.participants[0].id, contaId: ctx.contaId },
        select: eventParticipantScalarSelect,
      });
      return complete(NextResponse.json({ data: groupedParticipant ?? groupResult.participants[0] }, { status: 201 }), undefined, {
        participantCount: alunoIds.length,
      });
    }

    const paymentRulesError = isFeePaid || body.billingMethod === 'MANUAL_RECEIVED'
      ? null
      : validateEventPaymentRulesForCharge(paymentRules, balanceAmount);
    if (paymentRulesError) {
      return complete(NextResponse.json(
        { error: { code: 'REGRAS_COBRANCA_INVALIDAS', message: paymentRulesError } },
        { status: 422 },
      ), 'REGRAS_COBRANCA_INVALIDAS');
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
      entryPaymentMethod: entryAmount > 0 ? body.initialPaymentMethod ?? body.entryPaymentMethod ?? body.feePaymentMethod : null,
      initialPaymentAmount,
      initialPaymentMethod: body.initialPaymentMethod,
      billingMethod: body.billingMethod,
      isFeeExempt: body.isFeeExempt,
      isFeePaid,
      feePaymentMethod,
      notes: body.notes,
    });

    // 3. Se houver taxa cobrada e for cobrança digital via Asaas, gera a cobrança externa
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
          // Deleta participante criado (Rollback manual)
          await prisma.eventoContrato.deleteMany({
            where: { contaId: ctx.contaId, participantId: participant.id, status: 'PENDENTE' },
          });
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
            NOTIFICACOES_NAO_CONFIGURADAS: { status: 502, message: 'Não foi possível configurar as notificações. A cobrança não foi criada.' },
            RESPONSAVEL_OBRIGATORIO_MENOR: { status: 422, message: 'Aluno menor exige responsável financeiro vinculado' },
            ERRO_AO_CRIAR_PAGAMENTO: { status: 502, message: 'Erro ao criar pagamento no provedor' },
            COBRANCA_DUPLICADA: { status: 409, message: 'Cobrança duplicada' },
          };

          const errInfo = errorMap[billingResult.error] ?? { status: 500, message: `Erro ao gerar cobrança: ${billingResult.error}` };
          return complete(NextResponse.json({ error: { code: billingResult.error, message: errInfo.message } }, { status: errInfo.status }), billingResult.error);
        }

        await prisma.eventParticipant.update({
          where: { id: participant.id },
          data: {
            standaloneChargeId: billingResult.data.chargeId,
            asaasPaymentId: billingResult.data.asaasPaymentId ?? null,
            asaasInstallmentId: billingResult.data.asaasInstallmentId ?? null,
          },
        });
      } catch (billingError) {
        // Rollback caso ocorra exceção
        await prisma.eventoContrato.deleteMany({
          where: { contaId: ctx.contaId, participantId: participant.id, status: 'PENDENTE' },
        });
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

    const createdParticipant = await prisma.eventParticipant.findFirst({
      where: { id: participant.id, contaId: ctx.contaId },
      select: eventParticipantScalarSelect,
    });
    return complete(NextResponse.json({ data: createdParticipant ?? participant }, { status: 201 }));
  } catch (error) {
    if (isUniqueConstraintError(error) && tenantId && eventIdForLog && uiRequestId) {
      const existingGroup = await prisma.eventBillingGroup.findFirst({
        where: { contaId: tenantId, eventId: eventIdForLog, uiRequestId },
        include: { participants: { select: eventParticipantScalarSelect } },
      });
      if (existingGroup?.participants[0]) {
        return complete(NextResponse.json({ data: existingGroup.participants[0] }, { status: 200 }), undefined, {
          participantCount: existingGroup.participants.length,
          idempotentReplay: true,
        });
      }

    }

    return handleEventsRouteError(error, 'ERRO_REGISTRAR_PARTICIPANTE', {
      route,
      requestId,
      method: 'POST',
      startedAt,
      tenantId,
    });
  }
}
