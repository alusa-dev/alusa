import { NextRequest, NextResponse } from 'next/server';

import { registerEventParticipantRequestSchema } from '@alusa/lib/events/events.schema';
import { listEventParticipants, registerEventParticipant, registerEventParticipantGroup } from '@alusa/lib/events/events.service';
import { calculateEventParticipantDiscount } from '@alusa/lib/events/event-participant-discount';
import {
  eventPaymentRulesFromRecord,
  eventPaymentRulesToAsaas,
  validateEventPaymentRulesForCharge,
} from '@alusa/lib/events/events-payment-rules';
import { createStandaloneCharge } from '@alusa/finance';
import { prisma } from '@alusa/database';

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
  RESPONSAVEL_OBRIGATORIO_MENOR: { status: 422, message: 'Aluno menor exige responsável financeiro vinculado' },
  ERRO_AO_CRIAR_PAGAMENTO: { status: 502, message: 'Erro ao criar pagamento no provedor' },
  COBRANCA_DUPLICADA: { status: 409, message: 'Cobrança duplicada' },
};

function parseDueDate(value?: string) {
  return value ? new Date(`${value}T00:00:00.000`) : null;
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
  try {
    const { eventId } = await params;
    const ctx = await getEventsContext('events.update');
    const body = registerEventParticipantRequestSchema.parse(await request.json());

    // 1. Verificar se o evento existe
    const event = await prisma.schoolEvent.findFirst({
      where: { id: eventId, contaId: ctx.contaId },
    });
    if (!event) {
      return NextResponse.json({ error: { code: 'EVENTO_NAO_ENCONTRADO', message: 'Evento não encontrado' } }, { status: 404 });
    }

    // 2. Registrar o participante localmente. O modo manual pode começar sem
    // pagamento, com pagamento parcial ou totalmente quitado.
    const discount = calculateEventParticipantDiscount({
      originalAmount: body.registrationFeeOriginal ?? body.registrationFeeCharged,
      discountType: body.billingMethod === 'MANUAL_RECEIVED' ? body.discountType : null,
      discountValue: body.billingMethod === 'MANUAL_RECEIVED' ? body.discountValue : 0,
    });
    const registrationFeeCharged = discount.chargedAmount;
    const initialPaymentAmount = body.billingMethod === 'MANUAL_RECEIVED' ? body.initialPaymentAmount : 0;
    const effectiveRegistrationFeeCharged = body.isFeeExempt ? 0 : registrationFeeCharged;
    const entryAmount = body.hasEntry ? body.entryAmount : body.billingMethod === 'MANUAL_RECEIVED' ? initialPaymentAmount : 0;
    const isFeePaid = body.billingMethod === 'MANUAL_RECEIVED' && effectiveRegistrationFeeCharged > 0 && entryAmount >= effectiveRegistrationFeeCharged;
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
    const alunoIds = [...new Set([body.alunoId, ...(body.additionalAlunoIds ?? [])])];
    if (alunoIds.length > 1) {
      if (!body.responsavelId) {
        return NextResponse.json(
          { error: { code: 'RESPONSAVEL_FINANCEIRO_OBRIGATORIO', message: 'Selecione o responsável financeiro para agrupar as inscrições.' } },
          { status: 422 },
        );
      }

      const groupedBalanceBeforeCreate = Number((balanceAmount * alunoIds.length).toFixed(2));
      const groupPaymentRulesError = isFeePaid || body.billingMethod === 'MANUAL_RECEIVED'
        ? null
        : validateEventPaymentRulesForCharge(paymentRules, groupedBalanceBeforeCreate);
      if (groupPaymentRulesError) {
        return NextResponse.json(
          { error: { code: 'REGRAS_COBRANCA_INVALIDAS', message: groupPaymentRulesError } },
          { status: 422 },
        );
      }

      const groupResult = await registerEventParticipantGroup(ctx, {
        eventId,
        alunoId: body.alunoId,
        alunoIds,
        responsavelId: body.responsavelId,
        registrationFeeCharged: effectiveRegistrationFeeCharged,
        registrationFeeOriginal: discount.originalAmount,
        registrationFeeDiscount: discount.discountAmount,
        registrationFeeDiscountType: body.billingMethod === 'MANUAL_RECEIVED' && discount.discountAmount > 0 ? body.discountType : null,
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

      if (groupResult.reused || groupResult.group.status !== 'PENDING') {
        return NextResponse.json({ data: groupResult.participants[0] }, { status: 200 });
      }

      const groupBalanceAmount = Number(groupResult.group.balanceAmount);
      if (groupBalanceAmount > 0 && !isFeePaid) {
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
            return NextResponse.json({ error: { code: billingResult.error, message: errInfo.message } }, { status: errInfo.status });
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
      } else {
        await prisma.eventBillingGroup.update({ where: { id: groupResult.group.id, contaId: ctx.contaId }, data: { status: 'PAID' } });
      }

      const groupedParticipant = await prisma.eventParticipant.findFirst({ where: { id: groupResult.participants[0].id, contaId: ctx.contaId } });
      return NextResponse.json({ data: groupedParticipant ?? groupResult.participants[0] }, { status: 201 });
    }

    const paymentRulesError = isFeePaid || body.billingMethod === 'MANUAL_RECEIVED'
      ? null
      : validateEventPaymentRulesForCharge(paymentRules, balanceAmount);
    if (paymentRulesError) {
      return NextResponse.json(
        { error: { code: 'REGRAS_COBRANCA_INVALIDAS', message: paymentRulesError } },
        { status: 422 },
      );
    }

    const participant = await registerEventParticipant(ctx, {
      eventId,
      alunoId: body.alunoId,
      responsavelId: body.responsavelId,
      registrationFeeCharged: effectiveRegistrationFeeCharged,
      registrationFeeOriginal: discount.originalAmount,
      registrationFeeDiscount: discount.discountAmount,
      registrationFeeDiscountType: body.billingMethod === 'MANUAL_RECEIVED' && discount.discountAmount > 0 ? body.discountType : null,
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
            RESPONSAVEL_OBRIGATORIO_MENOR: { status: 422, message: 'Aluno menor exige responsável financeiro vinculado' },
            ERRO_AO_CRIAR_PAGAMENTO: { status: 502, message: 'Erro ao criar pagamento no provedor' },
            COBRANCA_DUPLICADA: { status: 409, message: 'Cobrança duplicada' },
          };

          const errInfo = errorMap[billingResult.error] ?? { status: 500, message: `Erro ao gerar cobrança: ${billingResult.error}` };
          return NextResponse.json({ error: { code: billingResult.error, message: errInfo.message } }, { status: errInfo.status });
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
    });
    return NextResponse.json({ data: createdParticipant ?? participant }, { status: 201 });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_REGISTRAR_PARTICIPANTE');
  }
}
