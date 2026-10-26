import {
  NotificationCategory,
  NotificationSeverity,
  NotificationType,
  Role,
  Status,
} from '@prisma/client';
import { createNotification } from '@alusa/lib/services/notifications.service';
import { buildAppUrl } from '@/lib/app-url';
import { sendTransactionalEmail } from '@/lib/email/transactional-email';
import prisma from '@/lib/prisma';
import { logApiOperationalEvent } from '@/lib/observability/api-logger';
import { PLATFORM_PLANS, type PlatformBillingEnvironment } from '@alusa/platform-billing';
import { resolvePlatformBillingEnvironment } from './platform-billing-server';
import { runWithTenant } from '@/lib/prisma-tenant';

type PlatformBillingNotification = {
  severity: NotificationSeverity;
  title: string;
  message: string;
  email?: {
    subject: string;
    preview: string;
    actionLabel?: string;
  };
};

export async function notifyPlatformBillingEvent(input: {
  contaId: string | null;
  eventId: string;
  eventType: string;
  sourceId?: string | null;
  environment?: PlatformBillingEnvironment;
}): Promise<void> {
  if (!input.contaId) return;

  if (input.eventType === 'platform.billing_trial_expired') {
    const contaId = input.contaId;
    if (!contaId) return;
    const billingAccountId = input.eventId.startsWith('trial-expired:')
      ? input.eventId.slice('trial-expired:'.length)
      : '';
    if (!billingAccountId) return;
    const environment = input.environment ?? resolvePlatformBillingEnvironment();
    const now = new Date();

    // Hold the same billing-account row lock used by the expiry detector while
    // the notification side effect runs. A payment webhook either commits
    // before this check and suppresses delivery, or waits until delivery ends.
    await runWithTenant(contaId, async (tx) => {
      const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "PlatformBillingAccount"
        WHERE "id" = ${billingAccountId}
          AND "contaId" = ${contaId}
          AND "environment" = ${environment}::"PlatformBillingEnvironment"
        FOR UPDATE
      `;
      if (lockedRows.length === 0) return;
      const account = await tx.platformBillingAccount.findFirst({
        where: {
          id: billingAccountId,
          contaId,
          environment,
          status: { in: ['TRIALING', 'PAUSED', 'UNPAID', 'ACTIVE'] },
          trialEndsAt: { lte: now },
          firstPaidAt: null,
          lastSuccessfulPaymentAt: null,
        },
        select: { id: true, planCode: true, trialEndsAt: true, stripeSubscriptionId: true },
      });
      if (!account) return;

      await createNotification({
        contaId,
        type: NotificationType.SYSTEM_ATTENTION,
        category: NotificationCategory.SYSTEM,
        severity: NotificationSeverity.CRITICAL,
        title: 'Seu período gratuito terminou',
        message: 'Seu período de teste acabou. Contrate e confirme o pagamento para liberar as operações de escrita.',
        dedupeKey: `platform-billing:trial-expired:${account.id}`,
        relatedPath: '/account/billing-plan',
        entityType: 'PlatformBillingAccount',
        entityId: account.id,
        sourceType: 'Stripe',
        sourceId: account.stripeSubscriptionId ?? account.id,
        metadata: { environment, planCode: account.planCode, trialEndsAt: account.trialEndsAt?.toISOString() ?? null },
        actor: { type: 'SYSTEM' },
        recipientRoles: [Role.ADMIN, Role.FINANCEIRO],
      });
    });
    return;
  }

  let trialTerms: { trialEndsAt: Date | null; planName: string; amountCents: number | null } | undefined;
  if (input.eventType === 'customer.subscription.trial_will_end') {
    const account = await prisma.platformBillingAccount.findFirst({
      where: { contaId: input.contaId, environment: input.environment ?? resolvePlatformBillingEnvironment() },
      select: { planCode: true, trialEndsAt: true },
    });
    const plan = account?.planCode ? PLATFORM_PLANS[account.planCode as keyof typeof PLATFORM_PLANS] : null;
    if (plan) trialTerms = { trialEndsAt: account?.trialEndsAt ?? null, planName: plan.name, amountCents: plan.amountCents };
  }

  const notification = mapPlatformBillingEventToNotification(input.eventType, trialTerms);
  if (!notification) return;

  await createNotification({
    contaId: input.contaId,
    type: NotificationType.SYSTEM_ATTENTION,
    category: NotificationCategory.SYSTEM,
    severity: notification.severity,
    title: notification.title,
    message: notification.message,
    dedupeKey: `platform-billing:${input.eventType}:${input.eventId}`,
    relatedPath: '/account/billing-plan',
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

  if (!notification.email) return;

  await sendPlatformBillingEmails({
    contaId: input.contaId,
    eventId: input.eventId,
    eventType: input.eventType,
    notification,
  }).catch((error) => {
    logApiOperationalEvent({
      severity: 'warn',
      eventName: 'api.platform_billing.notification_email.failed',
      route: '/api/webhooks/stripe',
      method: 'WORKER',
      requestId: crypto.randomUUID(),
      error,
    });
    throw error;
  });
}

async function sendPlatformBillingEmails(input: {
  contaId: string;
  eventId: string;
  eventType: string;
  notification: PlatformBillingNotification;
}): Promise<void> {
  const email = input.notification.email;
  if (!email) return;

  const recipients = await prisma.usuarioConta.findMany({
    where: {
      contaId: input.contaId,
      status: Status.ATIVO,
      role: { in: [Role.ADMIN, Role.FINANCEIRO] },
      usuario: {
        status: Status.ATIVO,
        notifyEmailProduct: true,
      },
    },
    select: {
      usuario: {
        select: {
          id: true,
          nome: true,
          email: true,
        },
      },
    },
    take: 10,
  });

  const actionUrl = buildAppUrl('/account/billing-plan');

  for (const recipient of recipients) {
    await sendTransactionalEmail({
      to: recipient.usuario.email,
      subject: email.subject,
      html: buildPlatformBillingEmailHtml({
        recipientName: recipient.usuario.nome,
        title: input.notification.title,
        message: input.notification.message,
        preview: email.preview,
        actionLabel: email.actionLabel ?? 'Abrir plano e faturamento',
        actionUrl,
      }),
      text: buildPlatformBillingEmailText({
        title: input.notification.title,
        message: input.notification.message,
        actionUrl,
      }),
      category: 'platform_billing',
      idempotencyKey: `platform-billing:${input.eventType}:${input.eventId}:${recipient.usuario.id}`,
      actionUrl,
      tags: [
        { name: 'category', value: 'platform_billing' },
        { name: 'event', value: input.eventType.slice(0, 64) },
      ],
    });
  }
}

function buildPlatformBillingEmailHtml(input: {
  recipientName: string;
  title: string;
  message: string;
  preview: string;
  actionLabel: string;
  actionUrl: string;
}): string {
  const greeting = escapeHtml(input.recipientName ? `Olá, ${input.recipientName}.` : 'Olá.');
  return [
    '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f1729;line-height:1.5">',
    `<p style="font-size:14px;color:#6b6275">${escapeHtml(input.preview)}</p>`,
    `<h1 style="font-size:22px;margin:12px 0;color:#361D56">${escapeHtml(input.title)}</h1>`,
    `<p>${greeting}</p>`,
    `<p>${escapeHtml(input.message)}</p>`,
    `<p><a href="${escapeHtml(input.actionUrl)}" style="display:inline-block;background:#512a82;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">${escapeHtml(input.actionLabel)}</a></p>`,
    '<p style="font-size:12px;color:#6b6275">Este aviso foi enviado pela Alusa para manter a assinatura da conta em dia.</p>',
    '</div>',
  ].join('');
}

function buildPlatformBillingEmailText(input: {
  title: string;
  message: string;
  actionUrl: string;
}): string {
  return `${input.title}\n\n${input.message}\n\nAcesse: ${input.actionUrl}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function mapPlatformBillingEventToNotification(
  eventType: string,
  trialTerms?: { trialEndsAt: Date | null; planName: string; amountCents: number | null },
): PlatformBillingNotification | null {
  if (eventType === 'platform.specialist_negotiation_ready') {
    return {
      severity: NotificationSeverity.WARNING,
      title: 'Mais de 500 alunos: converse com a Alusa',
      message: 'Sua escola ultrapassou 500 alunos em três fechamentos mensais consecutivos. O contrato e a operação atuais permanecem durante 30 dias para a negociação. Nenhum preço personalizado será aplicado automaticamente.',
      email: {
        subject: 'Vamos conversar sobre o crescimento da sua escola',
        preview: 'Sua escola ultrapassou o limite de contratação self-service.',
        actionLabel: 'Falar com um especialista',
      },
    };
  }

  if (eventType === 'checkout.session.completed') {
    return {
      severity: NotificationSeverity.INFO,
      title: 'Checkout da assinatura concluído',
      message: 'Stripe registrou a conclusão do checkout. O estado de pagamento e acesso será sincronizado após validação da assinatura.',
    };
  }

  if (eventType === 'customer.subscription.created') {
    return {
      severity: NotificationSeverity.INFO,
      title: 'Assinatura criada',
      message:
        'Stripe registrou uma assinatura para a conta. Consulte o status atual em Plano e faturamento.',
      email: {
        subject: 'Assinatura criada na Alusa',
        preview: 'Stripe registrou uma assinatura para a conta.',
        actionLabel: 'Acompanhar assinatura',
      },
    };
  }

  if (eventType === 'invoice.paid' || eventType === 'invoice.payment_succeeded') {
    return {
      severity: NotificationSeverity.SUCCESS,
      title: 'Pagamento de fatura confirmado',
      message: 'Stripe confirmou o pagamento de uma fatura da assinatura. Consulte o status atual em Plano e faturamento.',
      email: {
        subject: 'Pagamento de fatura confirmado',
        preview: 'Stripe confirmou o pagamento de uma fatura da assinatura.',
      },
    };
  }

  if (eventType === 'invoice.payment_failed' || eventType === 'invoice.payment_action_required') {
    return {
      severity: NotificationSeverity.WARNING,
      title: 'Pagamento da assinatura pendente',
      message:
        'Stripe sinalizou falha ou ação necessária em uma cobrança da assinatura. Verifique o pagamento em Plano e faturamento.',
      email: {
        subject: 'Pagamento da assinatura pendente',
        preview: 'Atualize o pagamento para evitar restrições no acesso.',
        actionLabel: 'Regularizar pagamento',
      },
    };
  }

  if (eventType === 'customer.subscription.trial_will_end') {
    const trialEndDate = trialTerms?.trialEndsAt
      ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(trialTerms.trialEndsAt)
      : null;
    const terms = trialTerms?.amountCents !== null && trialTerms?.amountCents !== undefined
      ? `${trialTerms.planName}, ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(trialTerms.amountCents / 100)}/mês`
      : 'a faixa atual de alunos';
    return {
      severity: NotificationSeverity.WARNING,
      title: 'Teste gratuito terminando',
      message:
        `Seu teste gratuito termina ${trialEndDate ? `em ${trialEndDate}` : 'em breve'}. A condição atual é ${terms}. Ao final, você escolhe se quer contratar e confirma o pagamento; sem confirmação, não haverá cobrança.`,
      email: {
        subject: 'Seu teste gratuito está terminando',
        preview: trialEndDate ? `Termina em ${trialEndDate} · ${terms}.` : `Em breve · ${terms}.`,
        actionLabel: 'Ver condição e contratar',
      },
    };
  }

  if (eventType === 'customer.subscription.updated') {
    return {
      severity: NotificationSeverity.INFO,
      title: 'Assinatura atualizada',
      message: 'O estado da assinatura foi sincronizado com segurança.',
    };
  }

  if (eventType === 'customer.subscription.deleted') {
    return {
      severity: NotificationSeverity.CRITICAL,
      title: 'Assinatura da Alusa encerrada',
      message: 'A assinatura comercial da conta foi encerrada.',
      email: {
        subject: 'Assinatura da Alusa encerrada',
        preview: 'A assinatura comercial da conta foi encerrada.',
        actionLabel: 'Ver assinatura',
      },
    };
  }

  return null;
}
