import { NotificationCategory, NotificationSeverity, NotificationType, Role } from '@prisma/client';
import { createNotification } from '@alusa/lib';

type PlatformBillingNotification = {
  severity: NotificationSeverity;
  title: string;
  message: string;
};

export async function notifyPlatformBillingEvent(input: {
  contaId: string | null;
  eventId: string;
  eventType: string;
  sourceId?: string | null;
}): Promise<void> {
  if (!input.contaId) return;

  const notification = mapPlatformBillingEventToNotification(input.eventType);
  if (!notification) return;

  await createNotification({
    contaId: input.contaId,
    type: NotificationType.SYSTEM_ATTENTION,
    category: NotificationCategory.SYSTEM,
    severity: notification.severity,
    title: notification.title,
    message: notification.message,
    dedupeKey: `platform-billing:${input.eventType}:${input.eventId}`,
    relatedPath: '/conta/plano-faturamento',
    entityType: 'PlatformBillingWebhookEvent',
    entityId: input.eventId,
    sourceType: 'Stripe',
    sourceId: input.sourceId ?? input.eventId,
    metadata: {
      eventType: input.eventType,
    },
    actor: { type: 'SYSTEM' },
    recipientRoles: [Role.ADMIN, Role.FINANCEIRO],
  });
}

function mapPlatformBillingEventToNotification(eventType: string): PlatformBillingNotification | null {
  if (eventType === 'checkout.session.completed') {
    return {
      severity: NotificationSeverity.SUCCESS,
      title: 'Pagamento da assinatura concluído',
      message: 'A assinatura foi confirmada e será refletida no plano da conta.',
    };
  }

  if (eventType === 'invoice.paid' || eventType === 'invoice.payment_succeeded') {
    return {
      severity: NotificationSeverity.SUCCESS,
      title: 'Pagamento da assinatura confirmado',
      message: 'A assinatura da Alusa foi regularizada.',
    };
  }

  if (eventType === 'invoice.payment_failed') {
    return {
      severity: NotificationSeverity.WARNING,
      title: 'Pagamento da assinatura falhou',
      message: 'A conta entrou em período de regularização. Atualize o pagamento em Plano e faturamento.',
    };
  }

  if (eventType === 'customer.subscription.deleted') {
    return {
      severity: NotificationSeverity.CRITICAL,
      title: 'Assinatura da Alusa encerrada',
      message: 'A assinatura comercial da conta foi encerrada.',
    };
  }

  return null;
}
