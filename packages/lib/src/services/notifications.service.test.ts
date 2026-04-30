import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NotificationCategory,
  NotificationSeverity,
  NotificationType,
} from '@prisma/client';

const txMock = {
  usuario: {
    findMany: vi.fn(),
  },
  notification: {
    findUnique: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
  notificationRecipient: {
    createMany: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
};

const prismaMock = {
  $transaction: vi.fn(async (callback: (tx: typeof txMock) => unknown) => callback(txMock)),
  cobranca: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  charge: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  notificationRecipient: {
    updateMany: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
};

vi.mock('../prisma', () => ({
  prisma: prismaMock,
}));

const {
  createNotification,
  createBillingWebhookNotification,
  deleteNotificationRecipient,
  markAllNotificationsAsRead,
  updateNotificationRecipientState,
  normalizeBillingNotificationEvent,
} = await import('./notifications.service');

describe('notifications.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txMock.usuario.findMany.mockResolvedValue([]);
    txMock.notification.findUnique.mockResolvedValue(null);
    txMock.notification.create.mockResolvedValue({ id: 'notif-new' });
    txMock.notificationRecipient.createMany.mockResolvedValue({ count: 0 });
    txMock.notification.deleteMany.mockResolvedValue({ count: 1 });
    txMock.notificationRecipient.deleteMany.mockResolvedValue({ count: 1 });
    txMock.notificationRecipient.count.mockResolvedValue(0);
    txMock.notificationRecipient.updateMany.mockResolvedValue({ count: 1 });
    txMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });
    prismaMock.cobranca.findUnique.mockResolvedValue(null);
    prismaMock.cobranca.findMany.mockResolvedValue([]);
    prismaMock.charge.findUnique.mockResolvedValue(null);
    prismaMock.charge.findMany.mockResolvedValue([]);
    prismaMock.notificationRecipient.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.notificationRecipient.findMany.mockResolvedValue([]);
    prismaMock.notificationRecipient.count.mockResolvedValue(0);
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });
  });

  it('cria notificacao e resolve destinatarios por role', async () => {
    txMock.usuario.findMany.mockResolvedValue([{ id: 'user-1' }, { id: 'user-2' }]);

    const result = await createNotification({
      contaId: 'conta-1',
      type: NotificationType.ENROLLMENT_CREATED,
      category: NotificationCategory.ENROLLMENT,
      severity: NotificationSeverity.INFO,
      title: 'Nova matrícula registrada',
      message: 'Aluno matriculado com sucesso.',
      dedupeKey: 'enrollment:created:mat-1',
      sourceType: 'MATRICULA',
      sourceId: 'mat-1',
    });

    expect(txMock.usuario.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contaId: 'conta-1',
          role: { in: ['ADMIN', 'FINANCEIRO', 'RECEPCAO'] },
        }),
      }),
    );
    expect(txMock.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contaId: 'conta-1',
          type: NotificationType.ENROLLMENT_CREATED,
          category: NotificationCategory.ENROLLMENT,
          dedupeKey: 'enrollment:created:mat-1',
        }),
      }),
    );
    expect(txMock.notificationRecipient.createMany).toHaveBeenCalledWith({
      data: [
        { notificationId: 'notif-new', contaId: 'conta-1', userId: 'user-1' },
        { notificationId: 'notif-new', contaId: 'conta-1', userId: 'user-2' },
      ],
      skipDuplicates: true,
    });
    expect(txMock.auditLog.create).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      notificationId: 'notif-new',
      created: true,
      recipientCount: 2,
    });
  });

  it('reaproveita notificacao existente quando a dedupeKey entra em conflito', async () => {
    const uniqueError = Object.assign(new Error('duplicate key'), { code: 'P2002' });
    txMock.notification.create.mockRejectedValueOnce(uniqueError);
    txMock.notification.findUnique.mockResolvedValueOnce({ id: 'notif-existing' });

    const result = await createNotification({
      contaId: 'conta-1',
      type: NotificationType.BILLING_OVERDUE,
      category: NotificationCategory.BILLING,
      severity: NotificationSeverity.WARNING,
      title: 'Cobrança em atraso',
      message: 'Existe uma cobrança em atraso.',
      dedupeKey: 'billing:PAYMENT_OVERDUE:pay-1',
      recipientUserIds: ['user-1', 'user-1', 'user-2'],
      sourceType: 'ASAAS_WEBHOOK',
      sourceId: 'pay-1',
    });

    expect(txMock.notification.create).toHaveBeenCalledTimes(1);
    expect(txMock.notification.findUnique).toHaveBeenCalledWith({
      where: {
        contaId_dedupeKey: {
          contaId: 'conta-1',
          dedupeKey: 'billing:PAYMENT_OVERDUE:pay-1',
        },
      },
      select: { id: true },
    });
    expect(txMock.notificationRecipient.createMany).toHaveBeenCalledWith({
      data: [
        { notificationId: 'notif-existing', contaId: 'conta-1', userId: 'user-1' },
        { notificationId: 'notif-existing', contaId: 'conta-1', userId: 'user-2' },
      ],
      skipDuplicates: true,
    });
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
    expect(result).toEqual({
      notificationId: 'notif-existing',
      created: false,
      recipientCount: 2,
    });
  });

  it('retorna sem efeitos colaterais quando nao ha destinatarios ativos', async () => {
    const result = await createNotification({
      contaId: 'conta-1',
      type: NotificationType.SYSTEM_ATTENTION,
      category: NotificationCategory.SYSTEM,
      severity: NotificationSeverity.CRITICAL,
      title: 'Ação necessária',
      message: 'Falha operacional detectada.',
      dedupeKey: 'system:attention:1',
    });

    expect(txMock.notification.create).not.toHaveBeenCalled();
    expect(txMock.notificationRecipient.createMany).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
    expect(result).toEqual({
      notificationId: null,
      created: false,
      recipientCount: 0,
    });
  });

  it('normaliza alias de evento financeiro antes de criar a notificação', async () => {
    txMock.usuario.findMany.mockResolvedValue([{ id: 'user-1' }]);
    prismaMock.charge.findUnique.mockResolvedValue({
      id: 'charge-1',
      contaId: 'conta-1',
      value: 80,
      dueDate: new Date('2026-03-13T12:00:00.000Z'),
      description: 'Mensalidade março',
      payerName: 'Bryan de Alencar',
      cobrancaId: 'cobranca-1',
      billingType: 'BOLETO',
    });

    await createBillingWebhookNotification({
      eventId: 'evt-1',
      eventName: 'PAYMENT_DUNNING_RECEIVED',
      asaasPaymentId: 'pay-1',
      sourceType: 'ASAAS_SYNC',
    });

    expect(txMock.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contaId: 'conta-1',
          dedupeKey: 'billing:DUNNING_RECEIVED:pay-1',
          sourceType: 'ASAAS_SYNC',
          metadata: expect.objectContaining({
            asaasPaymentId: 'pay-1',
            webhookEvent: 'DUNNING_RECEIVED',
            originalWebhookEvent: 'PAYMENT_DUNNING_RECEIVED',
            webhookEventId: 'evt-1',
          }),
        }),
      }),
    );
  });

  it('marca uma notificação como lida para o recipient correto', async () => {
    const updated = await updateNotificationRecipientState({
      contaId: 'conta-1',
      userId: 'user-1',
      notificationId: 'notif-1',
      action: 'read',
    });

    expect(updated).toBe(true);
    expect(prismaMock.notificationRecipient.updateMany).toHaveBeenCalledWith({
      where: {
        contaId: 'conta-1',
        userId: 'user-1',
        notificationId: 'notif-1',
      },
      data: expect.objectContaining({
        readAt: expect.any(Date),
      }),
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('exclui o recipient e remove a notificação quando ele é o último destinatário', async () => {
    const deleted = await deleteNotificationRecipient({
      contaId: 'conta-1',
      userId: 'user-1',
      notificationId: 'notif-1',
    });

    expect(deleted).toBe(true);
    expect(txMock.notificationRecipient.deleteMany).toHaveBeenCalledWith({
      where: {
        contaId: 'conta-1',
        userId: 'user-1',
        notificationId: 'notif-1',
      },
    });
    expect(txMock.notification.deleteMany).toHaveBeenCalledWith({
      where: {
        id: 'notif-1',
        contaId: 'conta-1',
      },
    });
  });

  it('marca todas as notificações ativas como lidas', async () => {
    prismaMock.notificationRecipient.updateMany.mockResolvedValueOnce({ count: 3 });

    const updatedCount = await markAllNotificationsAsRead({
      contaId: 'conta-1',
      userId: 'user-1',
    });

    expect(updatedCount).toBe(3);
    expect(prismaMock.notificationRecipient.updateMany).toHaveBeenCalledWith({
      where: {
        contaId: 'conta-1',
        userId: 'user-1',
        archivedAt: null,
        readAt: null,
      },
      data: {
        readAt: expect.any(Date),
      },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('expõe normalização previsível para o conjunto suportado de eventos financeiros', () => {
    expect(normalizeBillingNotificationEvent('PAYMENT_RECEIVED')).toBe('PAYMENT_RECEIVED');
    expect(normalizeBillingNotificationEvent('PAYMENT_DUNNING_RECEIVED')).toBe('DUNNING_RECEIVED');
    expect(normalizeBillingNotificationEvent('PAYMENT_REFUNDED')).toBeNull();
  });
});
