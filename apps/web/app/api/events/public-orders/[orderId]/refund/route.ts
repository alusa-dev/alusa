import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@alusa/database';
import {
  AsaasHttpError,
  KycNotApprovedError,
  auditLogService,
  isAsaasEnabled,
  readPaymentFullPreflight,
  refundCobranca,
  syncPaymentStateFromAsaas,
} from '@alusa/finance';
import { ticketSaleActionSchema } from '@alusa/lib/events/events.schema';

import { getEventsContext, handleEventsRouteError } from '../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ orderId: string }> };

const REFUNDABLE_STATUSES = new Set(['RECEIVED', 'CONFIRMED', 'DUNNING_RECEIVED']);

export async function POST(request: NextRequest, { params }: RouteParams) {
  const correlationId = randomUUID();

  try {
    const { orderId } = await params;
    const ctx = await getEventsContext('eventTickets.cancelSale');
    const body = ticketSaleActionSchema.parse(await request.json().catch(() => ({})));

    const order = await prisma.eventMapOrder.findFirst({
      where: { id: orderId, contaId: ctx.contaId },
      select: {
        id: true,
        eventId: true,
        asaasPaymentId: true,
        buyerName: true,
        buyerEmail: true,
        status: true,
        paymentStatus: true,
      },
    });

    if (!order) {
      return NextResponse.json({ error: { code: 'PEDIDO_NAO_ENCONTRADO', message: 'Pedido público não encontrado.' } }, { status: 404 });
    }

    if (!order.asaasPaymentId) {
      return NextResponse.json(
        { error: { code: 'PEDIDO_SEM_ASAAS', message: 'Pedido público sem cobrança vinculada no Asaas.' }, correlationId },
        { status: 400 },
      );
    }

    if (!isAsaasEnabled()) {
      return NextResponse.json(
        { error: { code: 'ASAAS_DESABILITADO', message: 'Integração financeira desabilitada.' }, correlationId },
        { status: 503 },
      );
    }

    const asaasPayment = await readPaymentFullPreflight(order.asaasPaymentId, { contaId: ctx.contaId });
    if (!REFUNDABLE_STATUSES.has(asaasPayment.status)) {
      return NextResponse.json(
        {
          error: {
            code: 'STATUS_NAO_ESTORNAVEL',
            message: `Operação não permitida. Status atual na plataforma financeira: ${asaasPayment.status}`,
          },
          correlationId,
        },
        { status: 400 },
      );
    }

    await refundCobranca({
      paymentId: order.asaasPaymentId,
      contaId: ctx.contaId,
      description: body.reason || `Estorno solicitado via Alusa - pedido público ${order.id} - ${correlationId}`,
    });

    try {
      await syncPaymentStateFromAsaas({
        contaId: ctx.contaId,
        asaasPaymentId: order.asaasPaymentId,
      });
    } catch (syncError) {
      console.warn('[events.public-order.refund] Falha ao sincronizar estado pós-comando', {
        correlationId,
        orderId: order.id,
        asaasPaymentId: order.asaasPaymentId,
        error: syncError instanceof Error ? syncError.message : String(syncError),
      });
    }

    await auditLogService.record({
      contaId: ctx.contaId,
      action: 'events.map.public.refund_requested',
      entity: { type: 'EventMapOrder', id: order.id },
      metadata: {
        correlationId,
        eventId: order.eventId,
        asaasPaymentId: order.asaasPaymentId,
        orderStatus: order.status,
        paymentStatus: order.paymentStatus,
        previousAsaasStatus: asaasPayment.status,
        requestedBy: ctx.userId,
        requestedByRole: ctx.role,
        buyerName: order.buyerName,
        buyerEmail: order.buyerEmail,
        reason: body.reason ?? null,
      },
    });

    await prisma.logFinanceiro.create({
      data: {
        contaId: ctx.contaId,
        usuarioId: ctx.userId,
        cobrancaId: null,
        acao: 'ESTORNAR_PEDIDO_PUBLICO_EVENTO',
        detalhes: {
          correlationId,
          orderId: order.id,
          eventId: order.eventId,
          asaasPaymentId: order.asaasPaymentId,
          previousAsaasStatus: asaasPayment.status,
          reason: body.reason ?? null,
        },
      },
    });

    return NextResponse.json(
      {
        data: {
          success: true,
          pending: true,
          correlationId,
          message: 'Estorno solicitado. Status será atualizado via webhook.',
        },
      },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof KycNotApprovedError) {
      return NextResponse.json(
        { error: { code: 'KYC_NAO_APROVADO', message: 'Conta não aprovada para operações financeiras.' }, correlationId },
        { status: 409 },
      );
    }

    if (error instanceof AsaasHttpError && error.status >= 400 && error.status < 500) {
      return NextResponse.json(
        {
          error: {
            code: 'ASAAS_REJEITOU_ESTORNO',
            message: 'Operação de estorno rejeitada pela plataforma financeira.',
            details: error.message,
          },
          correlationId,
        },
        { status: error.status },
      );
    }

    return handleEventsRouteError(error, 'ERRO_ESTORNAR_PEDIDO_PUBLICO_EVENTO');
  }
}
