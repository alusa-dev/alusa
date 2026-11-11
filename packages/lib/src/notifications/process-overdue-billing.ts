import { ChargeStatus, NotificationCategory, NotificationSeverity, NotificationType, StatusCobranca } from '@prisma/client';
import { prisma } from '../prisma';
import { logInboxMetric } from './inbox-metrics';
import {
  buildBillingNotificationDedupeKey,
  createNotification,
  resolveChargeOriginLabel,
  resolveBillingNotificationContent,
} from '../services/notifications.service';

const OVERDUE_STATUSES: StatusCobranca[] = [
  StatusCobranca.PENDENTE,
  StatusCobranca.ATRASADO,
];

const OVERDUE_CHARGE_STATUSES: ChargeStatus[] = [ChargeStatus.OPEN, ChargeStatus.OVERDUE];
const DUE_REMINDER_STATUS: StatusCobranca = StatusCobranca.PENDENTE;

export async function listContasForOverdueBillingNotifications(maxAccounts = 500) {
  const contas = await prisma.conta.findMany({
    where: { deletedAt: null },
    select: { id: true },
    take: maxAccounts,
  });
  return contas.map((conta) => conta.id);
}

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

function addCalendarDay(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function formatDateBr(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function persistedDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
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
  const tomorrowDateKey = addCalendarDay(dateKey);
  const afterTomorrowDateKey = addCalendarDay(tomorrowDateKey);
  const afterTomorrowStart = new Date(`${afterTomorrowDateKey}T12:00:00.000Z`);

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

    const dedupeKey = buildBillingNotificationDedupeKey('PAYMENT_OVERDUE', asaasPaymentId);
    const content = resolveBillingNotificationContent({
      eventName: 'PAYMENT_OVERDUE',
      formaPagamento: cobranca.formaPagamento,
      alunoNome: cobranca.matricula.aluno.nome,
      dueDate: cobranca.vencimento,
      value: Number(cobranca.valor),
      description: cobranca.descricao,
      originLabel: cobranca.descricao?.trim() || 'cobrança acadêmica',
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
        originLabel: cobranca.descricao?.trim() || 'cobrança acadêmica',
      },
      actor: { type: 'SYSTEM' },
    });

    if (result.created) {
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

  const dueSoonCharges = await prisma.cobranca.findMany({
    where: {
      contaId: params.contaId,
      status: DUE_REMINDER_STATUS,
      vencimento: { gte: todayStart, lt: afterTomorrowStart },
      matricula: { contaId: params.contaId, aluno: { contaId: params.contaId } },
    },
    select: {
      id: true,
      contaId: true,
      asaasPaymentId: true,
      valor: true,
      vencimento: true,
      descricao: true,
      matricula: { select: { aluno: { select: { id: true, nome: true } } } },
    },
    take: limit,
    orderBy: { vencimento: 'asc' },
  });

  for (const cobranca of dueSoonCharges) {
    if (persistedDateKey(cobranca.vencimento) !== tomorrowDateKey) continue;

    const stillPending = await prisma.cobranca.findFirst({
      where: { id: cobranca.id, contaId: params.contaId, status: DUE_REMINDER_STATUS },
      select: { id: true },
    });
    if (!stillPending) {
      skipped += 1;
      continue;
    }

    const detail = cobranca.descricao?.trim();
    const value = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(cobranca.valor));
    const reminderSubject = detail
      ? `A cobrança ${detail} da matrícula de ${cobranca.matricula.aluno.nome}`
      : `A cobrança da matrícula de ${cobranca.matricula.aluno.nome}`;
    const result = await createNotification({
      contaId: cobranca.contaId,
      type: NotificationType.SYSTEM_ATTENTION,
      category: NotificationCategory.BILLING,
      severity: NotificationSeverity.INFO,
      title: 'Cobrança vence amanhã',
      message: `${reminderSubject} vence amanhã (${formatDateBr(cobranca.vencimento)}), no valor de ${value}. Confira os detalhes para evitar atraso.`,
      dedupeKey: `billing:due-soon:${cobranca.id}:${tomorrowDateKey}`,
      relatedPath: `/cobrancas/${cobranca.id}`,
      entityType: 'Cobranca',
      entityId: cobranca.id,
      sourceType: 'LOCAL_CRON',
      sourceId: cobranca.id,
      metadata: {
        alunoId: cobranca.matricula.aluno.id,
        alunoNome: cobranca.matricula.aluno.nome,
        localDueReminder: true,
        dueDateKey: tomorrowDateKey,
      },
      actor: { type: 'SYSTEM' },
    });
    if (result.created) emitted += 1;
    else skipped += 1;
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

    const origin = await resolveChargeOriginLabel({
      contaId: params.contaId,
      chargeId: charge.id,
      asaasPaymentId: charge.asaasPaymentId,
    });
    const dedupeKey = buildBillingNotificationDedupeKey('PAYMENT_OVERDUE', charge.asaasPaymentId);
    const content = resolveBillingNotificationContent({
      eventName: 'PAYMENT_OVERDUE',
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

    const result = await createNotification({
      contaId: params.contaId,
      type: content.type,
      category: content.category,
      severity: content.severity,
      title: content.title,
      message: content.message,
      dedupeKey,
      relatedPath: origin.relatedPath,
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
        originLabel: origin.label,
        planId: origin.planId ?? null,
        planBillingType: origin.planBillingType ?? null,
        planValue: origin.planValue ?? null,
        planInstallmentCount: origin.planInstallmentCount ?? null,
        installmentPosition: origin.installmentPosition ?? null,
      },
      actor: { type: 'SYSTEM' },
    });

    if (result.created) {
      emitted += 1;
    } else {
      skipped += 1;
    }
  }

  return { emitted, skipped };
}
