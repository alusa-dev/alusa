import { prisma } from '../prisma';
import { logInboxMetric } from './inbox-metrics';
import type { Prisma } from '@prisma/client';
import { createNotification } from './notification-write';
import { createPaymentDigestNotification, PAYMENT_DIGEST_EVENTS, buildPaymentDigestDedupeKey, buildPaymentDigestEventKey } from './payment-digest';
import { BILLING_INBOX_EVENTS, isBillingNotificationEvent, normalizeBillingNotificationEvent, buildBillingNotificationDedupeKey, resolveBillingNotificationContent } from './notification-content';
import type { BillingNotificationEventInput, BillingOriginContextInput, BillingWebhookNotificationResult, CreateNotificationInput, WebhookNotificationEvent } from './notification-types';

function hasCanonicalAlusaPaymentReference(value: string | null | undefined): boolean {
  const reference = value?.trim();
  if (!reference) return false;
  return reference.startsWith('alusa:charge:') ||
    reference.startsWith('alusa:subscription:') ||
    reference.startsWith('alusa:installment:') ||
    reference.startsWith('alusa:standalone:') ||
    /^(?:subscription|installmentPlan|standaloneCharge|charge|standalone):[^:\s]+/.test(reference) ||
    /^enrollment-op:[^:\s]+:(?:subscription|fee)$/.test(reference) ||
    /^(?:event-map-order|event-entry):[^:\s]+$/.test(reference);
}
export function extractWebhookEventName(metadata: Prisma.JsonValue | null): WebhookNotificationEvent | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }

  const eventName = 'webhookEvent' in metadata ? metadata.webhookEvent : null;
  if (typeof eventName !== 'string') {
    return null;
  }

  return isBillingNotificationEvent(eventName) ? eventName : null;
}

export function extractBillingOriginContext(metadata: Prisma.JsonValue | null): BillingOriginContextInput | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = metadata as Record<string, unknown>;
  if (typeof value.originLabel !== 'string') return null;
  return {
    originLabel: value.originLabel,
    planId: typeof value.planId === 'string' ? value.planId : null,
    planBillingType: typeof value.planBillingType === 'string' ? value.planBillingType : null,
    planValue: typeof value.planValue === 'number' ? value.planValue : null,
    planInstallmentCount: typeof value.planInstallmentCount === 'number' ? value.planInstallmentCount : null,
    installmentPosition: typeof value.installmentPosition === 'number' ? value.installmentPosition : null,
  };
}
export async function resolveChargeOriginLabel(params: { contaId: string; chargeId: string; asaasPaymentId: string }): Promise<{
  label: string;
  relatedPath: string;
  planId?: string;
  planBillingType?: string;
  planValue?: number;
  planInstallmentCount?: number;
  installmentPosition?: number;
}> {
  const chargePlan = await prisma.charge.findFirst({
    where: { id: params.chargeId, contaId: params.contaId },
    select: { id: true, standaloneInstallmentPlanId: true },
  });
  const plan = chargePlan?.standaloneInstallmentPlanId
    ? await prisma.standaloneInstallmentPlan.findFirst({
        where: { id: chargePlan.standaloneInstallmentPlanId, contaId: params.contaId },
        select: { id: true, billingType: true, value: true, installmentCount: true, charges: { where: { contaId: params.contaId }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }], select: { id: true } } },
      })
    : null;
  const installmentPosition = plan?.charges.findIndex((item) => item.id === params.chargeId);
  const planContext = plan ? {
    planId: plan.id,
    planBillingType: plan.billingType,
    planValue: Number(plan.value),
    planInstallmentCount: plan.installmentCount,
    ...(installmentPosition != null && installmentPosition >= 0 ? { installmentPosition: installmentPosition + 1 } : {}),
  } : {};
  const [eventGroup, participant, financialEntry, eventOrder, ticketSale, charge] = await Promise.all([
    prisma.eventBillingGroup.findFirst({
      where: { contaId: params.contaId, OR: [
        { standaloneChargeId: params.chargeId },
        ...(chargePlan?.standaloneInstallmentPlanId ? [{ standaloneChargeId: chargePlan.standaloneInstallmentPlanId }] : []),
        { asaasPaymentId: params.asaasPaymentId },
      ] },
      select: { id: true, eventId: true, event: { select: { name: true } }, participants: { select: { id: true, displayName: true } } },
    }),
    prisma.eventParticipant.findFirst({
      where: { contaId: params.contaId, OR: [
        { asaasPaymentId: params.asaasPaymentId },
        { standaloneChargeId: params.chargeId },
        ...(chargePlan?.standaloneInstallmentPlanId ? [{ standaloneChargeId: chargePlan.standaloneInstallmentPlanId }] : []),
      ] },
      select: { id: true, eventId: true, displayName: true, event: { select: { name: true } } },
    }),
    prisma.eventFinancialEntry.findFirst({
      where: { contaId: params.contaId, asaasPaymentId: params.asaasPaymentId },
      select: { eventId: true, event: { select: { name: true } }, description: true, payments: { select: { participant: { select: { displayName: true } } } } },
    }),
    prisma.eventMapOrder.findFirst({
      where: { contaId: params.contaId, asaasPaymentId: params.asaasPaymentId },
      select: { eventId: true, event: { select: { name: true } } },
    }),
    prisma.eventTicketSale.findFirst({
      where: { contaId: params.contaId, asaasPaymentId: params.asaasPaymentId },
      select: { eventId: true, event: { select: { name: true } } },
    }),
    prisma.charge.findFirst({
      where: { id: params.chargeId, contaId: params.contaId },
      select: { sale: { select: { saleNumber: true } } },
    }),
  ]);
  if (eventGroup) {
    const participantId = eventGroup.participants.length === 1 ? eventGroup.participants[0]?.id : null;
    return {
      label: `taxa de inscrição no ${eventGroup.event.name}`,
      relatedPath: participantId ? `/events/${eventGroup.eventId}/participants/${participantId}` : `/events/${eventGroup.eventId}`,
      ...planContext,
    };
  }
  if (participant) {
    return {
      label: `taxa de inscrição no ${participant.event.name}`,
      relatedPath: `/events/${participant.eventId}/participants/${participant.id}`,
      ...planContext,
    };
  }
  if (financialEntry) {
    const participantNames = financialEntry.payments
      .map((payment) => payment.participant?.displayName)
      .filter((name): name is string => Boolean(name));
    return { label: `evento ${financialEntry.event.name}${participantNames.length ? `, participante ${Array.from(new Set(participantNames)).join(', ')}` : ''}`, relatedPath: `/events/${financialEntry.eventId}`, ...planContext };
  }
  if (eventOrder) return { label: `ingressos do evento ${eventOrder.event.name}`, relatedPath: `/events/${eventOrder.eventId}`, ...planContext };
  if (ticketSale) return { label: `ingressos do evento ${ticketSale.event.name}`, relatedPath: `/events/${ticketSale.eventId}`, ...planContext };
  if (charge?.sale) return { label: `venda avulsa #${charge.sale.saleNumber}`, relatedPath: '/financeiro/pagamentos', ...planContext };
  return { label: 'cobrança avulsa', relatedPath: '/cobrancas/avulsas', ...planContext };
}
export async function createBillingWebhookNotification(params: {
  contaId: string;
  eventId?: string | null;
  eventName: BillingNotificationEventInput;
  asaasPaymentId: string;
  asaasSubscriptionId?: string | null;
  asaasInstallmentId?: string | null;
  externalReference?: string | null;
  occurredAt?: Date;
  sourceType?: 'ASAAS_WEBHOOK' | 'ASAAS_SYNC';
}): Promise<BillingWebhookNotificationResult> {
  const normalizedEvent = normalizeBillingNotificationEvent(params.eventName);
  if (!normalizedEvent) {
    logInboxMetric('inbox.skipped.unsupported_event', {});
    return { outcome: 'not_applicable', reason: 'unsupported_event', notificationId: null, created: false, recipientCount: 0 };
  }

  if (!BILLING_INBOX_EVENTS.has(normalizedEvent)) {
    logInboxMetric('inbox.skipped.policy', {
      eventName: normalizedEvent,
      asaasPaymentId: params.asaasPaymentId,
      sourceType: params.sourceType ?? 'ASAAS_WEBHOOK',
    });
    return { outcome: 'not_applicable', reason: 'policy_excluded', notificationId: null, created: false, recipientCount: 0 };
  }

  const origins = await Promise.all([
    prisma.asaasResourceOrigin.findUnique({
      where: { uq_asaas_resource_origin_tenant_resource: {
        contaId: params.contaId, resourceType: 'PAYMENT', asaasId: params.asaasPaymentId,
      } },
      select: { origin: true },
    }),
    ...(params.asaasSubscriptionId ? [prisma.asaasResourceOrigin.findUnique({
      where: { uq_asaas_resource_origin_tenant_resource: {
        contaId: params.contaId, resourceType: 'SUBSCRIPTION', asaasId: params.asaasSubscriptionId,
      } },
      select: { origin: true },
    })] : []),
    ...(params.asaasInstallmentId ? [prisma.asaasResourceOrigin.findUnique({
      where: { uq_asaas_resource_origin_tenant_resource: {
        contaId: params.contaId, resourceType: 'INSTALLMENT', asaasId: params.asaasInstallmentId,
      } },
      select: { origin: true },
    })] : []),
  ]);
  const hasExternalOrigin = origins.some((origin) => origin?.origin === 'EXTERNAL');

  const externalOriginConflict = (): BillingWebhookNotificationResult => {
    logInboxMetric('inbox.failed.origin_inconsistent', {
      contaId: params.contaId,
      asaasPaymentId: params.asaasPaymentId,
      failureReason: 'external_origin_conflict',
    });
    return {
      outcome: 'inconsistent',
      reason: 'external_origin_conflict',
      notificationId: null,
      created: false,
      recipientCount: 0,
    };
  };

  const cobranca = await prisma.cobranca.findFirst({
    where: {
      contaId: params.contaId,
      OR: [
        { asaasPaymentId: params.asaasPaymentId },
        { asaasId: params.asaasPaymentId },
      ],
      matricula: { contaId: params.contaId, aluno: { contaId: params.contaId } },
    },
    select: {
      id: true,
      matriculaId: true,
      valor: true,
      vencimento: true,
      descricao: true,
      formaPagamento: true,
      matricula: {
        select: {
          id: true,
          aluno: {
            select: {
              contaId: true,
              id: true,
              nome: true,
            },
          },
        },
      },
    },
  });

  if (cobranca) {
    if (hasExternalOrigin) return externalOriginConflict();

    const content = resolveBillingNotificationContent({
      eventName: normalizedEvent,
      formaPagamento: cobranca.formaPagamento,
      alunoNome: cobranca.matricula.aluno.nome,
      dueDate: cobranca.vencimento,
      value: Number(cobranca.valor),
      description: cobranca.descricao,
      originLabel: cobranca.descricao?.trim() || 'cobrança acadêmica',
    });
    const notificationInput: CreateNotificationInput = {
      contaId: cobranca.matricula.aluno.contaId,
      type: content.type,
      category: content.category,
      severity: content.severity,
      title: content.title,
      message: content.message,
      dedupeKey: PAYMENT_DIGEST_EVENTS.has(normalizedEvent)
        ? buildPaymentDigestDedupeKey(normalizedEvent, params.occurredAt)
        : buildBillingNotificationDedupeKey(normalizedEvent, params.asaasPaymentId),
      relatedPath: `/cobrancas/${cobranca.id}`,
      entityType: 'Cobranca',
      entityId: cobranca.id,
      sourceType: params.sourceType ?? 'ASAAS_WEBHOOK',
      sourceId: params.asaasPaymentId,
      triggeredAt: params.occurredAt,
      metadata: {
        matriculaId: cobranca.matriculaId,
        alunoId: cobranca.matricula.aluno.id,
        alunoNome: cobranca.matricula.aluno.nome,
        asaasPaymentId: params.asaasPaymentId,
        webhookEvent: normalizedEvent,
        originalWebhookEvent: params.eventName,
        webhookEventId: params.eventId?.trim() || null,
        valor: Number(cobranca.valor),
        vencimento: cobranca.vencimento.toISOString(),
      },
      actor: {
        type: 'SYSTEM',
      },
    };

    if (PAYMENT_DIGEST_EVENTS.has(normalizedEvent)) {
      const result = await createPaymentDigestNotification({
        input: notificationInput,
        payment: {
          asaasPaymentId: params.asaasPaymentId,
          subject: cobranca.matricula.aluno.nome,
          value: Number(cobranca.valor),
          description: cobranca.descricao,
          paymentMethod: normalizedEvent === 'PAYMENT_RECEIVED_IN_CASH' ? 'CASH' : cobranca.formaPagamento,
          originLabel: 'cobrança acadêmica',
          relatedPath: `/cobrancas/${cobranca.id}`,
        },
        eventKey: buildPaymentDigestEventKey(normalizedEvent, params.asaasPaymentId),
      });
      return {
        ...result,
        outcome: result.notificationId ? 'completed' : result.reason ? 'not_applicable' : 'inconsistent',
        ...(!result.notificationId && !result.reason ? { reason: 'notification_result_unclassified' as const } : {}),
      };
    }

    const result = await createNotification(notificationInput);
    return {
      ...result,
      outcome: result.notificationId ? 'completed' : result.reason ? 'not_applicable' : 'inconsistent',
      ...(!result.notificationId && !result.reason ? { reason: 'notification_result_unclassified' as const } : {}),
    };
  }

  const charge = await prisma.charge.findUnique({
    where: {
      uq_charge_conta_asaas_payment: {
        contaId: params.contaId,
        asaasPaymentId: params.asaasPaymentId,
      },
    },
    select: {
      id: true,
      contaId: true,
      value: true,
      dueDate: true,
      description: true,
      payerName: true,
      cobrancaId: true,
      billingType: true,
    },
  });

  if (!charge) {
    const [eventMapOrder, eventTicketSales] = await Promise.all([
      prisma.eventMapOrder.findFirst({
        where: { contaId: params.contaId, asaasPaymentId: params.asaasPaymentId },
        select: {
          id: true,
          contaId: true,
          eventId: true,
          buyerName: true,
          totalAmount: true,
          paymentMethod: true,
          paymentStatus: true,
          status: true,
          ticketFulfillmentStatus: true,
          items: { select: { id: true, ticket: { select: { id: true } } } },
          event: { select: { name: true } },
        },
      }),
      prisma.eventTicketSale.findMany({
        where: { contaId: params.contaId, asaasPaymentId: params.asaasPaymentId },
        select: { id: true, eventId: true, eventMapOrderId: true, buyerName: true, totalAmount: true, paymentMethod: true, event: { select: { name: true } } },
      }),
    ]);
    const [eventTicketSale] = eventTicketSales;
    const linkedEventMapOrder = !eventMapOrder && eventTicketSale?.eventMapOrderId
      ? await prisma.eventMapOrder.findFirst({
          where: { id: eventTicketSale.eventMapOrderId, contaId: params.contaId },
          select: {
            id: true,
            contaId: true,
            eventId: true,
            buyerName: true,
            totalAmount: true,
            paymentMethod: true,
            paymentStatus: true,
            status: true,
            ticketFulfillmentStatus: true,
            items: { select: { id: true, ticket: { select: { id: true } } } },
            event: { select: { name: true } },
          },
        })
      : null;
    const publicOrder = eventMapOrder ?? linkedEventMapOrder;
    const saleOrderIds = new Set(eventTicketSales.map((sale) => sale.eventMapOrderId));
    const hasDivergentSaleOrigins = saleOrderIds.size > 1 || (eventTicketSales.length > 1 && saleOrderIds.has(null));

    if (eventMapOrder || eventTicketSale) {
      if (
        hasDivergentSaleOrigins ||
        (publicOrder && eventTicketSales.some((sale) => sale.eventMapOrderId !== publicOrder.id))
      ) {
        logInboxMetric('inbox.failed.origin_inconsistent', {
          failureReason: 'event_order_sale_link_conflict',
        });
        return {
          outcome: 'inconsistent',
          reason: 'event_order_sale_link_conflict',
          notificationId: null,
          created: false,
          recipientCount: 0,
        };
      }
      if (eventTicketSale?.eventMapOrderId && !publicOrder) {
        return {
          outcome: 'not_applicable',
          reason: 'event_ticket_payment',
          notificationId: null,
          created: false,
          recipientCount: 0,
        };
      }

      if (publicOrder) {
        return {
          outcome: 'not_applicable',
          reason: 'event_ticket_payment',
          notificationId: null,
          created: false,
          recipientCount: 0,
        };
      }

      if (hasExternalOrigin) return externalOriginConflict();

      const eventName = eventTicketSale?.event?.name ?? 'evento';
      const subject = eventTicketSale?.buyerName ?? 'Responsável';
      const total = eventTicketSale?.totalAmount ?? null;
      const content = resolveBillingNotificationContent({
        eventName: normalizedEvent,
        billingType: eventTicketSale?.paymentMethod,
        payerName: subject,
        value: total == null ? null : Number(total),
        description: `ingressos do evento ${eventName}`,
        originLabel: `ingressos do evento ${eventName}`,
      });
      const input: CreateNotificationInput = {
        contaId: params.contaId,
        type: content.type,
        category: content.category,
        severity: content.severity,
        title: content.title,
        message: content.message,
        dedupeKey: PAYMENT_DIGEST_EVENTS.has(normalizedEvent)
          ? buildPaymentDigestDedupeKey(normalizedEvent, params.occurredAt)
          : buildBillingNotificationDedupeKey(normalizedEvent, params.asaasPaymentId),
        relatedPath: `/events/${eventTicketSale?.eventId}`,
        entityType: 'EventTicketSale',
        entityId: eventTicketSale?.id ?? null,
        sourceType: params.sourceType ?? 'ASAAS_WEBHOOK',
        sourceId: params.asaasPaymentId,
        triggeredAt: params.occurredAt,
        metadata: { asaasPaymentId: params.asaasPaymentId, webhookEvent: normalizedEvent, eventName },
        actor: { type: 'SYSTEM' },
      };
      if (PAYMENT_DIGEST_EVENTS.has(normalizedEvent)) {
        const digestResult = await createPaymentDigestNotification({
          input,
          payment: {
            asaasPaymentId: params.asaasPaymentId,
            subject,
            value: total == null ? null : Number(total),
            description: null,
            paymentMethod: normalizedEvent === 'PAYMENT_RECEIVED_IN_CASH' ? 'CASH' : eventTicketSale?.paymentMethod,
            originLabel: `ingressos do evento ${eventName}`,
            relatedPath: input.relatedPath,
          },
          eventKey: buildPaymentDigestEventKey(normalizedEvent, params.asaasPaymentId),
        });
        return { ...digestResult, outcome: digestResult.notificationId ? 'completed' : digestResult.reason ? 'not_applicable' : 'inconsistent' };
      }

      const eventResult = await createNotification({ ...input, dedupeKey: buildBillingNotificationDedupeKey(normalizedEvent, params.asaasPaymentId) });
      return { ...eventResult, outcome: eventResult.notificationId ? 'completed' : eventResult.reason ? 'not_applicable' : 'inconsistent' };
    }

    const hasAlusaOrigin = origins.some((origin) => origin?.origin === 'ALUSA');
    if (hasAlusaOrigin && hasExternalOrigin) {
      return { outcome: 'inconsistent', reason: 'external_origin_conflict', notificationId: null, created: false, recipientCount: 0 };
    }
    if (hasExternalOrigin && hasCanonicalAlusaPaymentReference(params.externalReference)) {
      return externalOriginConflict();
    }
    const conta = await prisma.conta.findUnique({
      where: { id: params.contaId },
      select: { financeIntegrationMode: true },
    });
    if (
      !hasCanonicalAlusaPaymentReference(params.externalReference) && !hasAlusaOrigin &&
      (hasExternalOrigin || conta?.financeIntegrationMode === 'EXTERNAL_ASAAS_ACCOUNT')
    ) {
      logInboxMetric('inbox.skipped.external_unlinked_payment', {
        contaId: params.contaId,
        asaasPaymentId: params.asaasPaymentId,
        sourceType: params.sourceType ?? 'ASAAS_WEBHOOK',
      });
      return { outcome: 'not_applicable', reason: 'external_account_unlinked_payment', notificationId: null, created: false, recipientCount: 0 };
    }

    logInboxMetric('inbox.skipped.no_entity', {
      eventName: normalizedEvent,
      asaasPaymentId: params.asaasPaymentId,
      asaasSubscriptionId: params.asaasSubscriptionId ?? null,
      asaasInstallmentId: params.asaasInstallmentId ?? null,
      externalReference: params.externalReference ?? null,
      sourceType: params.sourceType ?? 'ASAAS_WEBHOOK',
    });
    const pendingInbox = await import('../notifications/pending-inbox-notifications');
    await pendingInbox.enqueuePendingBillingWebhookNotification({
      contaId: params.contaId,
      eventId: params.eventId ?? null,
      eventName: normalizedEvent,
      asaasPaymentId: params.asaasPaymentId,
      asaasSubscriptionId: params.asaasSubscriptionId ?? null,
      asaasInstallmentId: params.asaasInstallmentId ?? null,
      externalReference: params.externalReference ?? null,
      occurredAt: params.occurredAt?.toISOString() ?? null,
      sourceType: params.sourceType ?? 'ASAAS_WEBHOOK',
    });
    return { outcome: 'entity_missing', notificationId: null, created: false, recipientCount: 0 };
  }

  if (hasExternalOrigin) return externalOriginConflict();

  const origin = charge.cobrancaId
    ? { label: 'cobrança acadêmica', relatedPath: `/cobrancas/${charge.cobrancaId}` }
    : await resolveChargeOriginLabel({ contaId: charge.contaId, chargeId: charge.id, asaasPaymentId: params.asaasPaymentId });

  const content = resolveBillingNotificationContent({
    eventName: normalizedEvent,
    billingType: charge.billingType,
    payerName: charge.payerName,
    dueDate: charge.dueDate,
    value: charge.value ? Number(charge.value) : null,
    description: charge.description,
    originLabel: origin.label,
    planId: origin.planId ?? null,
    planBillingType: origin.planBillingType ?? null,
    planValue: origin.planValue ?? null,
    planInstallmentCount: origin.planInstallmentCount ?? null,
    installmentPosition: origin.installmentPosition ?? null,
  });
  const notificationInput: CreateNotificationInput = {
    contaId: charge.contaId,
    type: content.type,
    category: content.category,
    severity: content.severity,
    title: content.title,
    message: content.message,
    dedupeKey: PAYMENT_DIGEST_EVENTS.has(normalizedEvent)
      ? buildPaymentDigestDedupeKey(normalizedEvent, params.occurredAt)
      : buildBillingNotificationDedupeKey(normalizedEvent, params.asaasPaymentId),
    relatedPath: origin.relatedPath,
    entityType: charge.cobrancaId ? 'Cobranca' : 'Charge',
    entityId: charge.cobrancaId ?? charge.id,
    sourceType: params.sourceType ?? 'ASAAS_WEBHOOK',
    sourceId: params.asaasPaymentId,
    triggeredAt: params.occurredAt,
    metadata: {
      chargeId: charge.id,
      payerName: charge.payerName,
      asaasPaymentId: params.asaasPaymentId,
      webhookEvent: normalizedEvent,
      originalWebhookEvent: params.eventName,
      webhookEventId: params.eventId?.trim() || null,
      valor: charge.value ? Number(charge.value) : null,
      vencimento: charge.dueDate?.toISOString() ?? null,
      originLabel: origin.label,
      planId: origin.planId ?? null,
      planBillingType: origin.planBillingType ?? null,
      planValue: origin.planValue ?? null,
      planInstallmentCount: origin.planInstallmentCount ?? null,
      installmentPosition: origin.installmentPosition ?? null,
    },
    actor: {
      type: 'SYSTEM',
    },
  };

  if (PAYMENT_DIGEST_EVENTS.has(normalizedEvent)) {
    const result = await createPaymentDigestNotification({
      input: notificationInput,
      payment: {
        asaasPaymentId: params.asaasPaymentId,
        subject: charge.payerName ?? 'Responsável',
        value: charge.value ? Number(charge.value) : null,
        description: charge.description,
          paymentMethod: normalizedEvent === 'PAYMENT_RECEIVED_IN_CASH' ? 'CASH' : charge.billingType,
        originLabel: origin.label,
        relatedPath: origin.relatedPath,
        planId: origin.planId ?? null,
        planBillingType: origin.planBillingType ?? null,
        planValue: origin.planValue ?? null,
        planInstallmentCount: origin.planInstallmentCount ?? null,
        installmentPosition: origin.installmentPosition ?? null,
      },
      eventKey: buildPaymentDigestEventKey(normalizedEvent, params.asaasPaymentId),
    });
    return {
      ...result,
      outcome: result.notificationId ? 'completed' : result.reason ? 'not_applicable' : 'inconsistent',
      ...(!result.notificationId && !result.reason ? { reason: 'notification_result_unclassified' as const } : {}),
    };
  }

  const result = await createNotification(notificationInput);
  return {
    ...result,
    outcome: result.notificationId ? 'completed' : result.reason ? 'not_applicable' : 'inconsistent',
    ...(!result.notificationId && !result.reason ? { reason: 'notification_result_unclassified' as const } : {}),
  };
}
