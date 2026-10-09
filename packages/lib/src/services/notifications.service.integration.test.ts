import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { prisma } from '@alusa/database';

import { createBillingWebhookNotification } from './notifications.service';

describe('notifications.service tenant isolation integration', () => {
  it('does not resolve a legacy payment from another tenant and creates the matching tenant notification', async () => {
    const runId = randomUUID();
    const contaIds: string[] = [];

    try {
      const contaA = await prisma.conta.create({
        data: { nome: `Notification A ${runId}`, cpfCnpj: `A${runId.replaceAll('-', '').slice(0, 13)}` },
      });
      contaIds.push(contaA.id);
      const contaB = await prisma.conta.create({
        data: { nome: `Notification B ${runId}`, cpfCnpj: `B${runId.replaceAll('-', '').slice(0, 13)}` },
      });
      contaIds.push(contaB.id);

      const [userA, userB] = await Promise.all([
        prisma.usuario.create({
          data: {
            contaId: contaA.id,
            nome: 'Finance User A',
            email: `notification-a-${runId}@example.test`,
            senhaHash: 'integration-test',
            role: 'ADMIN',
            status: 'ATIVO',
          },
        }),
        prisma.usuario.create({
          data: {
            contaId: contaB.id,
            nome: 'Finance User B',
            email: `notification-b-${runId}@example.test`,
            senhaHash: 'integration-test',
            role: 'ADMIN',
            status: 'ATIVO',
          },
        }),
      ]);

      const alunoA = await prisma.aluno.create({
        data: { contaId: contaA.id, nome: 'Student A', dataNasc: new Date('2010-01-01T00:00:00.000Z') },
      });
      const alunoB = await prisma.aluno.create({
        data: { contaId: contaB.id, nome: 'Student B', dataNasc: new Date('2010-01-01T00:00:00.000Z') },
      });
      const matriculaA = await prisma.matricula.create({
        data: {
          contaId: contaA.id,
          alunoId: alunoA.id,
          dataInicio: new Date('2026-01-01T00:00:00.000Z'),
          dataFimContrato: new Date('2026-12-31T00:00:00.000Z'),
          taxaMatricula: 0,
        },
      });
      const matriculaB = await prisma.matricula.create({
        data: {
          contaId: contaB.id,
          alunoId: alunoB.id,
          dataInicio: new Date('2026-01-01T00:00:00.000Z'),
          dataFimContrato: new Date('2026-12-31T00:00:00.000Z'),
          taxaMatricula: 0,
        },
      });
      const paymentA = `pay_legacy_a_${runId}`;
      const paymentB = `pay_legacy_b_${runId}`;
      const cobrancaA = await prisma.cobranca.create({
        data: {
          contaId: contaA.id,
          matriculaId: matriculaA.id,
          competenciaInicio: new Date('2026-01-01T00:00:00.000Z'),
          competenciaFim: new Date('2026-01-31T00:00:00.000Z'),
          valor: 100,
          vencimento: new Date('2026-01-10T00:00:00.000Z'),
          formaPagamento: 'PIX',
          status: 'PENDENTE',
          asaasId: paymentA,
        },
      });
      await prisma.cobranca.create({
        data: {
          contaId: contaB.id,
          matriculaId: matriculaB.id,
          competenciaInicio: new Date('2026-01-01T00:00:00.000Z'),
          competenciaFim: new Date('2026-01-31T00:00:00.000Z'),
          valor: 100,
          vencimento: new Date('2026-01-10T00:00:00.000Z'),
          formaPagamento: 'PIX',
          status: 'PENDENTE',
          asaasId: paymentB,
        },
      });

      const wrongTenantResult = await createBillingWebhookNotification({
        contaId: contaA.id,
        eventName: 'PAYMENT_OVERDUE',
        asaasPaymentId: paymentB,
      });
      expect(wrongTenantResult).toEqual({ notificationId: null, created: false, recipientCount: 0 });

      const pendingInboxAcrossTenants = await prisma.pendingInboxNotification.findMany({
        where: { contaId: { in: [contaA.id, contaB.id] } },
        select: { contaId: true, payload: true },
      });
      expect(pendingInboxAcrossTenants).toHaveLength(1);
      expect(pendingInboxAcrossTenants[0]).toMatchObject({
        contaId: contaA.id,
        payload: { asaasPaymentId: paymentB },
      });

      const notificationForB = await prisma.notification.findMany({
        where: { contaId: contaB.id, sourceId: paymentB },
      });
      const recipientsForB = await prisma.notificationRecipient.findMany({
        where: { contaId: contaB.id, userId: userB.id },
      });
      expect(notificationForB).toHaveLength(0);
      expect(recipientsForB).toHaveLength(0);

      const correctTenantResult = await createBillingWebhookNotification({
        contaId: contaA.id,
        eventName: 'PAYMENT_OVERDUE',
        asaasPaymentId: paymentA,
      });
      expect(correctTenantResult).toMatchObject({ created: true, recipientCount: 1 });

      const notificationForA = await prisma.notification.findFirst({
        where: { contaId: contaA.id, entityType: 'Cobranca', entityId: cobrancaA.id },
        include: { recipients: true },
      });
      expect(notificationForA?.contaId).toBe(contaA.id);
      expect(notificationForA?.recipients.map((recipient) => recipient.userId)).toEqual([userA.id]);
    } finally {
      if (contaIds.length > 0) {
        await prisma.pendingInboxNotification.deleteMany({ where: { contaId: { in: contaIds } } });
        await prisma.notificationDigestEvent.deleteMany({ where: { contaId: { in: contaIds } } });
        await prisma.notificationRecipient.deleteMany({ where: { contaId: { in: contaIds } } });
        await prisma.notification.deleteMany({ where: { contaId: { in: contaIds } } });
        await prisma.auditLog.deleteMany({ where: { contaId: { in: contaIds }, action: 'notification.created' } });
        await prisma.cobranca.deleteMany({ where: { contaId: { in: contaIds } } });
        await prisma.matricula.deleteMany({ where: { contaId: { in: contaIds } } });
        await prisma.aluno.deleteMany({ where: { contaId: { in: contaIds } } });
        await prisma.usuario.deleteMany({ where: { contaId: { in: contaIds } } });
        await prisma.conta.deleteMany({ where: { id: { in: contaIds } } });
      }
    }
  });
});
