import { ChargeStatus, StatusCobranca } from '@prisma/client';
import { prisma } from '../prisma';
import { logInboxMetric } from './inbox-metrics';
import { createNotification, resolveBillingNotificationContent } from '../services/notifications.service';

const OVERDUE_STATUSES: StatusCobranca[] = [
  StatusCobranca.PENDENTE,
  StatusCobranca.ATRASADO,
];

const OVERDUE_CHARGE_STATUSES: ChargeStatus[] = [ChargeStatus.OPEN, ChargeStatus.OVERDUE];

function startOfDayInTimezone(date: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return new Date(`${year}-${month}-${day}T12:00:00.000Z`);
}

function dateKeyInTimezone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
}

/**
 * Emite notificações de cobrança vencida para cobranças que entraram em atraso
 * no dia corrente (timezone do tenant), como fallback ao webhook PAYMENT_OVERDUE.
 */
export async function processLocalOverdueBillingNotifications(params: {
  contaId: string;
  limit?: number;
}): Promise<{ emitted: number; skipped: number }> {
  const limit = Math.min(Math.max(params.limit ?? 200, 1), 500);
  const conta = await prisma.conta.findUnique({
    where: { id: params.contaId },
    select: { timezone: true },
  });
  const timeZone = conta?.timezone?.trim() || 'America/Sao_Paulo';
  const todayStart = startOfDayInTimezone(new Date(), timeZone);
  const dateKey = dateKeyInTimezone(new Date(), timeZone);

  let emitted = 0;
  let skipped = 0;

  const cobrancas = await prisma.cobranca.findMany({
    where: {
      matricula: { aluno: { contaId: params.contaId } },
      status: { in: OVERDUE_STATUSES },
      vencimento: { lt: todayStart },
      asaasPaymentId: { not: null },
    },
    select: {
      id: true,
      asaasPaymentId: true,
      valor: true,
      vencimento: true,
      descricao: true,
      formaPagamento: true,
      matriculaId: true,
      matricula: {
        select: {
          aluno: { select: { id: true, nome: true, contaId: true } },
        },
      },
    },
    take: limit,
    orderBy: { vencimento: 'asc' },
  });

  for (const cobranca of cobrancas) {
    const asaasPaymentId = cobranca.asaasPaymentId;
    if (!asaasPaymentId) {
      skipped += 1;
      continue;
    }

    const dedupeKey = `billing:local-overdue:${cobranca.id}:${dateKey}`;
    const existing = await prisma.notification.findUnique({
      where: {
        contaId_dedupeKey: {
          contaId: cobranca.matricula.aluno.contaId,
          dedupeKey,
        },
      },
      select: { id: true },
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    const content = resolveBillingNotificationContent({
      eventName: 'PAYMENT_OVERDUE',
      formaPagamento: cobranca.formaPagamento,
      alunoNome: cobranca.matricula.aluno.nome,
      dueDate: cobranca.vencimento,
      value: Number(cobranca.valor),
      description: cobranca.descricao,
    });

    const result = await createNotification({
      contaId: cobranca.matricula.aluno.contaId,
      type: content.type,
      category: content.category,
      severity: content.severity,
      title: content.title,
      message: content.message,
      dedupeKey,
      relatedPath: `/cobrancas/${cobranca.id}`,
      entityType: 'Cobranca',
      entityId: cobranca.id,
      sourceType: 'LOCAL_CRON',
      sourceId: cobranca.id,
      metadata: {
        matriculaId: cobranca.matriculaId,
        alunoId: cobranca.matricula.aluno.id,
        alunoNome: cobranca.matricula.aluno.nome,
        asaasPaymentId,
        webhookEvent: 'PAYMENT_OVERDUE',
        localOverdue: true,
        overdueDateKey: dateKey,
      },
      actor: { type: 'SYSTEM' },
    });

    if (result.notificationId) {
      emitted += 1;
      logInboxMetric('inbox.overdue.emitted', {
        cobrancaId: cobranca.id,
        dedupeKey,
        contaId: params.contaId,
      });
    } else {
      skipped += 1;
    }

  }

  const charges = await prisma.charge.findMany({
    where: {
      contaId: params.contaId,
      cobrancaId: null,
      status: { in: OVERDUE_CHARGE_STATUSES },
      dueDate: { lt: todayStart },
      asaasPaymentId: { not: null },
    },
    select: {
      id: true,
      asaasPaymentId: true,
      value: true,
      dueDate: true,
      description: true,
      payerName: true,
      billingType: true,
    },
    take: Math.max(0, limit - cobrancas.length),
    orderBy: { dueDate: 'asc' },
  });

  for (const charge of charges) {
    if (!charge.asaasPaymentId || !charge.dueDate) {
      skipped += 1;
      continue;
    }

    const dedupeKey = `billing:local-overdue:charge:${charge.id}:${dateKey}`;
    const existing = await prisma.notification.findUnique({
      where: { contaId_dedupeKey: { contaId: params.contaId, dedupeKey } },
      select: { id: true },
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    const content = resolveBillingNotificationContent({
      eventName: 'PAYMENT_OVERDUE',
      billingType: charge.billingType,
      payerName: charge.payerName,
      dueDate: charge.dueDate,
      value: charge.value ? Number(charge.value) : null,
      description: charge.description,
    });

    const result = await createNotification({
      contaId: params.contaId,
      type: content.type,
      category: content.category,
      severity: content.severity,
      title: content.title,
      message: content.message,
      dedupeKey,
      relatedPath: '/cobrancas/avulsas',
      entityType: 'Charge',
      entityId: charge.id,
      sourceType: 'LOCAL_CRON',
      sourceId: charge.id,
      metadata: {
        chargeId: charge.id,
        asaasPaymentId: charge.asaasPaymentId,
        webhookEvent: 'PAYMENT_OVERDUE',
        localOverdue: true,
        overdueDateKey: dateKey,
      },
      actor: { type: 'SYSTEM' },
    });

    if (result.notificationId) {
      emitted += 1;
    } else {
      skipped += 1;
    }
  }

  return { emitted, skipped };
}
