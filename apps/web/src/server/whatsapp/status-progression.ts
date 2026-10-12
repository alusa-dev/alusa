import {
  EventTicketWhatsAppNotificationStatus,
  WhatsAppMessageStatus,
} from '@prisma/client';

export function mapWhatsAppProviderStatus(status: string): WhatsAppMessageStatus {
  if (status === 'delivered') return WhatsAppMessageStatus.DELIVERED;
  if (status === 'read') return WhatsAppMessageStatus.READ;
  if (status === 'failed') return WhatsAppMessageStatus.FAILED;
  return WhatsAppMessageStatus.SENT;
}

export function canAdvanceWhatsAppMessageStatus(current: WhatsAppMessageStatus, next: WhatsAppMessageStatus) {
  if (current === WhatsAppMessageStatus.READ) return false;
  if (current === WhatsAppMessageStatus.DELIVERED) return next === WhatsAppMessageStatus.READ;
  if (next === WhatsAppMessageStatus.FAILED) return current === WhatsAppMessageStatus.QUEUED || current === WhatsAppMessageStatus.SENT;
  if (next === WhatsAppMessageStatus.SENT) return current === WhatsAppMessageStatus.QUEUED;
  if (next === WhatsAppMessageStatus.DELIVERED) return true;
  if (next === WhatsAppMessageStatus.READ) return true;
  return false;
}

export function toTicketNotificationStatus(status: WhatsAppMessageStatus): EventTicketWhatsAppNotificationStatus {
  if (status === WhatsAppMessageStatus.DELIVERED) return EventTicketWhatsAppNotificationStatus.DELIVERED;
  if (status === WhatsAppMessageStatus.READ) return EventTicketWhatsAppNotificationStatus.READ;
  if (status === WhatsAppMessageStatus.FAILED) return EventTicketWhatsAppNotificationStatus.FAILED;
  return EventTicketWhatsAppNotificationStatus.SENT;
}

export function canAdvanceTicketNotificationStatus(
  current: EventTicketWhatsAppNotificationStatus,
  next: EventTicketWhatsAppNotificationStatus,
) {
  if (current === EventTicketWhatsAppNotificationStatus.READ) return false;
  if (current === EventTicketWhatsAppNotificationStatus.DELIVERED) return next === EventTicketWhatsAppNotificationStatus.READ;
  if (next === EventTicketWhatsAppNotificationStatus.FAILED) {
    return current === EventTicketWhatsAppNotificationStatus.QUEUED || current === EventTicketWhatsAppNotificationStatus.SENT;
  }
  if (next === EventTicketWhatsAppNotificationStatus.SENT) return current === EventTicketWhatsAppNotificationStatus.QUEUED;
  if (next === EventTicketWhatsAppNotificationStatus.DELIVERED) {
    return current !== EventTicketWhatsAppNotificationStatus.SKIPPED;
  }
  if (next === EventTicketWhatsAppNotificationStatus.READ) {
    return current !== EventTicketWhatsAppNotificationStatus.SKIPPED;
  }
  return false;
}
