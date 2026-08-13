import { NotificationType } from '@prisma/client';

/**
 * Eventos que representam uma mudança operacional relevante para a inbox.
 *
 * Eventos síncronos de sucesso continuam sendo comunicados pelo toast da tela
 * e permanecem disponíveis na auditoria, mas não poluem a inbox operacional.
 */
export const INTERNAL_NOTIFICATION_TYPES = new Set<NotificationType>([
  NotificationType.ENROLLMENT_CANCELLED,
  NotificationType.BILLING_OVERDUE,
  NotificationType.BILLING_CANCELLED,
  NotificationType.PAYMENT_CONFIRMED,
  NotificationType.PAYMENT_REFUNDED,
  NotificationType.CONTRACT_SIGNED,
  NotificationType.CONTRACT_EXPIRING,
  NotificationType.CONTRACT_EXPIRED,
  NotificationType.CONTRACT_CANCELLED,
  NotificationType.SYSTEM_ATTENTION,
  NotificationType.TRANSFER_DONE,
  NotificationType.TRANSFER_FAILED,
  NotificationType.TRANSFER_CANCELLED,
  NotificationType.BALANCE_BLOCKED,
  NotificationType.ACCESS_TOKEN_ALERT,
  NotificationType.WEBHOOK_INTERRUPTED,
  NotificationType.WEBHOOK_DLQ,
]);

export function isInternalNotificationTypeAllowed(type: NotificationType): boolean {
  return INTERNAL_NOTIFICATION_TYPES.has(type);
}

export function isLowValueNotificationType(type: NotificationType): boolean {
  return !isInternalNotificationTypeAllowed(type);
}

export function getLowValueNotificationTypes(): NotificationType[] {
  return Object.values(NotificationType).filter((type) => !INTERNAL_NOTIFICATION_TYPES.has(type));
}
