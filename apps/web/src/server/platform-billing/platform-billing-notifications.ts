import { NotificationCategory, NotificationSeverity, NotificationType, Role, Status } from '@prisma/client';
import { createNotification } from '@alusa/lib';
import { buildAppUrl } from '@/lib/app-url';
import { sendTransactionalEmail } from '@/lib/email/transactional-email';
import prisma from '@/lib/prisma';

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

  if (!notification.email) return;

  await sendPlatformBillingEmails({
    contaId: input.contaId,
    eventId: input.eventId,
    eventType: input.eventType,
    notification,
  }).catch((error) => {
    console.warn('[platform-billing][notification-email]', {
      contaId: input.contaId,
      eventId: input.eventId,
      eventType: input.eventType,
      error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
    });
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

  const actionUrl = buildAppUrl('/conta/plano-faturamento');

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

function buildPlatformBillingEmailText(input: { title: string; message: string; actionUrl: string }): string {
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

function mapPlatformBillingEventToNotification(eventType: string): PlatformBillingNotification | null {
  if (eventType === 'checkout.session.completed') {
    return {
      severity: NotificationSeverity.SUCCESS,
      title: 'Pagamento da assinatura concluído',
      message: 'A assinatura foi confirmada e será refletida no plano da conta.',
    };
  }

  if (eventType === 'customer.subscription.created') {
    return {
      severity: NotificationSeverity.SUCCESS,
      title: 'Assinatura iniciada',
      message: 'A assinatura da Alusa está ativa. Acompanhe o plano e o pagamento em Plano e faturamento.',
      email: {
        subject: 'Assinatura iniciada na Alusa',
        preview: 'A assinatura da conta está ativa.',
        actionLabel: 'Acompanhar assinatura',
      },
    };
  }

  if (eventType === 'invoice.paid' || eventType === 'invoice.payment_succeeded') {
    return {
      severity: NotificationSeverity.SUCCESS,
      title: 'Pagamento da assinatura confirmado',
      message: 'A assinatura da Alusa foi regularizada.',
      email: {
        subject: 'Pagamento da assinatura confirmado',
        preview: 'A assinatura da Alusa foi regularizada.',
      },
    };
  }

  if (eventType === 'invoice.payment_failed' || eventType === 'invoice.payment_action_required') {
    return {
      severity: NotificationSeverity.WARNING,
      title: 'Pagamento da assinatura pendente',
      message: 'A conta entrou em período de regularização. Atualize o pagamento em Plano e faturamento.',
      email: {
        subject: 'Pagamento da assinatura pendente',
        preview: 'Atualize o pagamento para evitar restrições no acesso.',
        actionLabel: 'Regularizar pagamento',
      },
    };
  }

  if (eventType === 'customer.subscription.trial_will_end') {
    return {
      severity: NotificationSeverity.WARNING,
      title: 'Teste gratuito terminando',
      message: 'O teste gratuito está perto do fim. Cadastre um cartão para evitar pausa no acesso.',
      email: {
        subject: 'Seu teste gratuito está terminando',
        preview: 'Cadastre um cartão para evitar pausa no acesso.',
        actionLabel: 'Cadastrar pagamento',
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
