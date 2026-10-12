import { describe, expect, it } from 'vitest';
import { EventTicketWhatsAppNotificationStatus as Notification, WhatsAppMessageStatus as Message } from '@prisma/client';
import {
  canAdvanceTicketNotificationStatus,
  canAdvanceWhatsAppMessageStatus,
  mapWhatsAppProviderStatus,
  toTicketNotificationStatus,
} from './status-progression';

describe('WhatsApp callback status progression', () => {
  it('keeps sent, delivered, and read monotonic when callbacks arrive out of order', () => {
    expect(canAdvanceWhatsAppMessageStatus(Message.DELIVERED, Message.SENT)).toBe(false);
    expect(canAdvanceWhatsAppMessageStatus(Message.READ, Message.DELIVERED)).toBe(false);
    expect(canAdvanceTicketNotificationStatus(Notification.DELIVERED, Notification.SENT)).toBe(false);
    expect(canAdvanceTicketNotificationStatus(Notification.READ, Notification.DELIVERED)).toBe(false);
    expect(canAdvanceWhatsAppMessageStatus(Message.DELIVERED, Message.READ)).toBe(true);
    expect(canAdvanceTicketNotificationStatus(Notification.DELIVERED, Notification.READ)).toBe(true);
  });

  it('accepts a provider failure after acceptance, but never downgrades delivery', () => {
    const failed = mapWhatsAppProviderStatus('failed');
    expect(canAdvanceWhatsAppMessageStatus(Message.SENT, failed)).toBe(true);
    expect(canAdvanceWhatsAppMessageStatus(Message.DELIVERED, failed)).toBe(false);
    expect(canAdvanceTicketNotificationStatus(Notification.SENT, toTicketNotificationStatus(failed))).toBe(true);
    expect(canAdvanceTicketNotificationStatus(Notification.READ, toTicketNotificationStatus(failed))).toBe(false);
  });

  it('does not revive notifications skipped after consent was withdrawn', () => {
    expect(canAdvanceTicketNotificationStatus(Notification.SKIPPED, Notification.DELIVERED)).toBe(false);
    expect(canAdvanceTicketNotificationStatus(Notification.SKIPPED, Notification.READ)).toBe(false);
  });
});
