import { NotificationCategory, NotificationSeverity, NotificationType } from '@prisma/client';
import type { BillingOriginContextInput } from './notification-types';
import { BILLING_NOTIFICATION_EVENT_ALIASES, BILLING_NOTIFICATION_EVENTS } from './notification-events';
import type { BillingNotificationEventInput, WebhookNotificationEvent } from './notification-events';

export { BILLING_NOTIFICATION_EVENT_ALIASES, BILLING_NOTIFICATION_EVENTS } from './notification-events';
export type { BillingNotificationEventInput, WebhookNotificationEvent } from './notification-events';

export function formatCurrency(value: number | null | undefined): string | null {
  if (value == null || Number.isNaN(value)) return null;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}
function formatDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}
export const BILLING_INBOX_EVENTS = new Set<WebhookNotificationEvent>([
  'PAYMENT_CREATED',
  'PAYMENT_RESTORED',
  'PAYMENT_OVERDUE',
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED',
  'PAYMENT_RECEIVED_IN_CASH',
  'PAYMENT_REPROVED_BY_RISK_ANALYSIS',
  'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED',
  'DUNNING_RECEIVED',
  'PAYMENT_REFUNDED',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_DELETED',
]);

export function normalizeBillingNotificationEvent(eventName: string): WebhookNotificationEvent | null {
  const normalized = eventName in BILLING_NOTIFICATION_EVENT_ALIASES
    ? BILLING_NOTIFICATION_EVENT_ALIASES[eventName as keyof typeof BILLING_NOTIFICATION_EVENT_ALIASES]
    : eventName;

  return (BILLING_NOTIFICATION_EVENTS as readonly string[]).includes(normalized)
    ? (normalized as WebhookNotificationEvent)
    : null;
}

export function isBillingNotificationEvent(eventName: string): eventName is WebhookNotificationEvent {
  return normalizeBillingNotificationEvent(eventName) !== null;
}

export function buildBillingNotificationDedupeKey(
  eventName: WebhookNotificationEvent,
  asaasPaymentId: string,
): string {
  const canonicalEvent = {
    PAYMENT_CONFIRMED: 'payment:confirmed',
    PAYMENT_RECEIVED: 'payment:confirmed',
    PAYMENT_RECEIVED_IN_CASH: 'payment:confirmed',
    PAYMENT_REPROVED_BY_RISK_ANALYSIS: 'payment:risk_analysis_reproved',
    PAYMENT_CREDIT_CARD_CAPTURE_REFUSED: 'payment:card_capture_refused',
    DUNNING_RECEIVED: 'payment:recovered',
    PAYMENT_OVERDUE: 'billing:overdue',
    PAYMENT_REFUNDED: 'payment:refunded',
    PAYMENT_CHARGEBACK_REQUESTED: 'payment:chargeback',
    PAYMENT_DELETED: 'billing:cancelled',
    PAYMENT_RESTORED: 'billing:restored',
    PAYMENT_CREATED: 'billing:created',
  }[eventName];

  return `${canonicalEvent ?? `billing:${eventName}`}:${asaasPaymentId}`;
}

type BillingChannel = 'PIX' | 'BOLETO' | 'CREDIT_CARD' | 'CASH' | 'UNDEFINED';

function normalizeBillingChannel(params: {
  eventName: WebhookNotificationEvent;
  billingType?: string | null;
  formaPagamento?: string | null;
}): BillingChannel {
  if (params.eventName === 'PAYMENT_RECEIVED_IN_CASH') {
    return 'CASH';
  }

  const raw = (params.billingType ?? params.formaPagamento ?? 'UNDEFINED').trim().toUpperCase();

  if (raw === 'PIX' || raw === 'MANUAL_PIX') return 'PIX';
  if (raw === 'BOLETO') return 'BOLETO';
  if (raw === 'CARTAO_CREDITO' || raw === 'CREDIT_CARD' || raw === 'EXTERNAL_CARD') return 'CREDIT_CARD';
  if (raw === 'CASH' || raw === 'DINHEIRO') return 'CASH';
  return 'UNDEFINED';
}

function mapWebhookEventToNotification(params: {
  eventName: WebhookNotificationEvent;
  billingChannel: BillingChannel;
}): {
  type: NotificationType;
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
} {
  if (params.eventName === 'PAYMENT_CREATED') {
    return {
      type: NotificationType.BILLING_CREATED,
      category: NotificationCategory.BILLING,
      severity: NotificationSeverity.INFO,
      title:
        params.billingChannel === 'PIX'
          ? 'Pix disponível'
          : params.billingChannel === 'BOLETO'
            ? 'Boleto disponível'
            : params.billingChannel === 'CREDIT_CARD'
              ? 'Nova cobrança via cartão'
              : 'Nova cobrança',
    };
  }

  if (params.eventName === 'PAYMENT_OVERDUE') {
    return {
      type: NotificationType.BILLING_OVERDUE,
      category: NotificationCategory.BILLING,
      severity: NotificationSeverity.WARNING,
      title: 'Pagamento em atraso',
    };
  }

  if (
    params.eventName === 'PAYMENT_REPROVED_BY_RISK_ANALYSIS' ||
    params.eventName === 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED'
  ) {
    return {
      type: NotificationType.SYSTEM_ATTENTION,
      category: NotificationCategory.PAYMENT,
      severity: NotificationSeverity.WARNING,
      title: params.eventName === 'PAYMENT_REPROVED_BY_RISK_ANALYSIS'
        ? 'Pagamento não aprovado'
        : 'Captura do cartão não concluída',
    };
  }

  if (params.eventName === 'PAYMENT_RECEIVED_IN_CASH') {
    return {
      type: NotificationType.PAYMENT_CONFIRMED,
      category: NotificationCategory.PAYMENT,
      severity: NotificationSeverity.SUCCESS,
      title: 'Pagamento recebido',
    };
  }

  if (params.eventName === 'PAYMENT_RECEIVED') {
    return {
      type: NotificationType.PAYMENT_CONFIRMED,
      category: NotificationCategory.PAYMENT,
      severity: NotificationSeverity.SUCCESS,
      title: 'Pagamento recebido',
    };
  }

  if (params.eventName === 'DUNNING_RECEIVED') {
    return {
      type: NotificationType.PAYMENT_CONFIRMED,
      category: NotificationCategory.PAYMENT,
      severity: NotificationSeverity.SUCCESS,
      title: 'Pagamento recebido',
    };
  }

  if (params.eventName === 'PAYMENT_REFUNDED') {
    return {
      type: NotificationType.PAYMENT_REFUNDED,
      category: NotificationCategory.PAYMENT,
      severity: NotificationSeverity.WARNING,
      title: 'Pagamento devolvido',
    };
  }

  if (params.eventName === 'PAYMENT_CHARGEBACK_REQUESTED') {
    return {
      type: NotificationType.PAYMENT_REFUNDED,
      category: NotificationCategory.PAYMENT,
      severity: NotificationSeverity.CRITICAL,
      title: 'Pagamento contestado',
    };
  }

  if (params.eventName === 'PAYMENT_DELETED') {
    return {
      type: NotificationType.BILLING_CANCELLED,
      category: NotificationCategory.BILLING,
      severity: NotificationSeverity.WARNING,
      title: 'Cobrança cancelada',
    };
  }

  if (params.eventName === 'PAYMENT_RESTORED') {
    return {
      type: NotificationType.BILLING_CREATED,
      category: NotificationCategory.BILLING,
      severity: NotificationSeverity.INFO,
      title: 'Cobrança reativada',
    };
  }

  // PAYMENT_CONFIRMED (fallback)
  return {
    type: NotificationType.PAYMENT_CONFIRMED,
    category: NotificationCategory.PAYMENT,
    severity: NotificationSeverity.SUCCESS,
    title: 'Pagamento recebido',
  };
}



function isCardInstallmentPlan(params: BillingOriginContextInput): boolean {
  return Boolean(params.planId && ['CREDIT_CARD', 'CARTAO_CREDITO'].includes(params.planBillingType?.toUpperCase() ?? ''));
}

function resolveBillingOriginContext(params: BillingOriginContextInput): string {
  const origin = params.originLabel?.trim();
  const rawDetail = params.description?.trim();
  const detail = params.planId && rawDetail
    ? rawDetail.replace(/^parcela\s+(?:\d+\s+de\s+\d+|\d+\s*\/\s*\d+)\s*(?:[-–—.:|,]\s*)?/i, '').trim()
    : rawDetail;
  if (!origin) return detail ?? '';
  if (!detail) return origin;

  const normalize = (value: string) => value
    .toLocaleLowerCase('pt-BR')
    .replace(/\bevento\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  const normalizedOrigin = normalize(origin);
  const normalizedDetail = normalize(detail);
  if (
    detail === origin ||
    normalizedDetail === normalizedOrigin ||
    normalizedDetail.includes(normalizedOrigin) ||
    normalizedOrigin.includes(normalizedDetail)
  ) return origin;
  return `${origin}, ${detail}`;
}

function resolveBillingObligationLabel(params: BillingOriginContextInput): string {
  const origin = resolveBillingOriginContext(params);
  if (!origin) return '';
  if (
    params.planId &&
    !isCardInstallmentPlan(params) &&
    (params.planInstallmentCount ?? 0) > 1 &&
    params.installmentPosition
  ) {
    return `parcela ${params.installmentPosition} de ${params.planInstallmentCount} da ${origin}`;
  }
  return origin;
}

function buildBillingMessage(params: {
  eventName: WebhookNotificationEvent;
  billingChannel: BillingChannel;
  alunoNome?: string | null;
  payerName?: string | null;
  dueDate?: Date | null;
  value?: number | null;
  description?: string | null;
  originLabel?: string | null;
  planId?: string | null;
  planBillingType?: string | null;
  planValue?: number | null;
  planInstallmentCount?: number | null;
  installmentPosition?: number | null;
}): string {
  const subject = params.alunoNome ?? params.payerName ?? 'o responsável financeiro';
  const dueDate = formatDate(params.dueDate);
  const cardInstallmentPlan = isCardInstallmentPlan(params);
  const effectiveValue = cardInstallmentPlan && params.eventName !== 'PAYMENT_OVERDUE'
    ? params.planValue ?? params.value
    : params.value;
  const value = formatCurrency(effectiveValue);
  const description = params.description?.trim() || null;
  const originContext = resolveBillingObligationLabel(params);
  const originPhrase = originContext ? `da ${originContext} de ${subject}` : `de ${subject}`;
  const cardInstallmentSuffix = cardInstallmentPlan && params.planInstallmentCount && params.eventName !== 'PAYMENT_OVERDUE'
    ? `, em ${params.planInstallmentCount} vezes no cartão`
    : '';

  if (params.eventName === 'PAYMENT_CREATED') {
    const chargeLabel = params.billingChannel === 'PIX'
      ? 'via Pix'
      : params.billingChannel === 'BOLETO'
        ? 'via boleto'
        : params.billingChannel === 'CREDIT_CARD'
          ? 'no cartão de crédito'
          : 'com a forma de pagamento informada';
    const context = originContext || description;
    return `Uma cobrança foi criada para ${subject}${context ? `, referente a ${context}` : ''}${value ? `, no valor de ${value}` : ''}${cardInstallmentSuffix}${dueDate ? `, com vencimento em ${dueDate}` : ''} ${chargeLabel}.`;
  }

  if (params.eventName === 'PAYMENT_OVERDUE') {
    return `O pagamento ${originContext ? `da ${originContext} de ${subject}` : `de ${subject}`} está em atraso${dueDate ? `. O vencimento foi em ${dueDate}` : ''}${value ? `${dueDate ? ' e' : ';'} o valor pendente é ${value}` : ''}${cardInstallmentSuffix}.`;
  }
  if (params.eventName === 'PAYMENT_REPROVED_BY_RISK_ANALYSIS') {
    return `O pagamento ${originPhrase}${value ? `, no valor de ${value}` : ''}${cardInstallmentSuffix} não foi aprovado. Confira o status da cobrança antes de solicitar uma nova tentativa.`;
  }
  if (params.eventName === 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED') {
    return `Não foi possível concluir o pagamento ${originPhrase}${value ? `, no valor total de ${value}` : ''}${cardInstallmentSuffix}. Confira o status da cobrança antes de solicitar uma nova tentativa.`;
  }
  if (params.eventName === 'PAYMENT_RECEIVED_IN_CASH') {
    return `Pagamento recebido em dinheiro ${originPhrase}${value ? `, no valor de ${value}` : ''}.`;
  }
  if (params.eventName === 'PAYMENT_RECEIVED') {
    const channel = params.billingChannel === 'PIX' ? ' via Pix' : params.billingChannel === 'BOLETO' ? ' via boleto' : params.billingChannel === 'CREDIT_CARD' ? ' via cartão' : '';
    return `Pagamento recebido ${originPhrase}${value ? `, no valor de ${value}` : ''}${channel}.`;
  }
  if (params.eventName === 'DUNNING_RECEIVED') {
    return `Pagamento recebido ${originPhrase}${value ? `, no valor de ${value}` : ''}. A pendência foi regularizada.`;
  }
  if (params.eventName === 'PAYMENT_REFUNDED') {
    return `O pagamento ${originPhrase}${value ? `, no valor de ${value}` : ''} foi devolvido ao pagador.`;
  }
  if (params.eventName === 'PAYMENT_CHARGEBACK_REQUESTED') {
    return `O pagador contestou o pagamento ${originPhrase}${value ? `, no valor de ${value}` : ''}. Acompanhe a análise e consulte os detalhes da cobrança.`;
  }
  if (params.eventName === 'PAYMENT_DELETED') {
    return `A cobrança ${originPhrase}${value ? `, no valor de ${value}` : ''} foi cancelada.`;
  }
  if (params.eventName === 'PAYMENT_RESTORED') {
    return `A cobrança ${originPhrase}${value ? `, no valor de ${value}` : ''} foi reativada${dueDate ? `, com vencimento em ${dueDate}` : ''}.`;
  }

  const channel = params.billingChannel === 'PIX' ? 'Pix' : params.billingChannel === 'BOLETO' ? 'boleto' : params.billingChannel === 'CREDIT_CARD' ? 'cartão de crédito' : 'forma de pagamento informada';
  return `Pagamento ${originPhrase}${value ? `, no valor de ${value}` : ''} confirmado via ${channel}.`;
}

export function resolveBillingNotificationContent(params: {
  eventName: WebhookNotificationEvent;
  billingType?: string | null;
  formaPagamento?: string | null;
  alunoNome?: string | null;
  payerName?: string | null;
  dueDate?: Date | null;
  value?: number | null;
  description?: string | null;
  originLabel?: string | null;
  planId?: string | null;
  planBillingType?: string | null;
  planValue?: number | null;
  planInstallmentCount?: number | null;
  installmentPosition?: number | null;
}) {
  const billingChannel = normalizeBillingChannel({
    eventName: params.eventName,
    billingType: params.billingType,
    formaPagamento: params.formaPagamento,
  });
  const mapped = mapWebhookEventToNotification({ eventName: params.eventName, billingChannel });
  return {
    ...mapped,
    message: buildBillingMessage({
      eventName: params.eventName,
      billingChannel,
      alunoNome: params.alunoNome,
      payerName: params.payerName,
      dueDate: params.dueDate,
      value: params.value,
      description: params.description,
      originLabel: params.originLabel,
      planId: params.planId,
      planBillingType: params.planBillingType,
      planValue: params.planValue,
      planInstallmentCount: params.planInstallmentCount,
      installmentPosition: params.installmentPosition,
    }),
  };
}
