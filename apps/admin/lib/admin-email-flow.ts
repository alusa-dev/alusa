import { Resend } from 'resend';
import type { Role } from '@prisma/client';

type Delivery = { delivery: 'sent' | 'logged'; emailId: string | null };

const INVITE_TEMPLATE_ID = process.env.RESEND_INVITE_TEMPLATE_ID || 'd13d18cf-e209-43b5-8d8b-d6a7d937cbed';

function roleLabel(role: Role) {
  const labels: Partial<Record<Role, string>> = {
    ADMIN: 'administrador', PROFESSOR: 'professor', RECEPCAO: 'recepção',
    FINANCEIRO: 'financeiro', RESPONSAVEL: 'responsável',
  };
  return labels[role] ?? 'usuário';
}

function formatInviteExpiration(expiresAt: Date | string): string {
  const date = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return 'a data informada';

  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Manaus',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).format(date);
}

function logEmail(input: { email: string; subject: string; inviteUrl: string }) {
  console.info('[EMAIL][ADMIN_DEV_FALLBACK]', { to: input.email, subject: input.subject, actionUrl: input.inviteUrl });
}

function getInviteSender(): string {
  const sender = process.env.EMAIL_FROM_INVITES || process.env.EMAIL_FROM_AUTH;
  if (!sender) {
    throw new Error('EMAIL_FROM_INVITES ausente para o envio de convites.');
  }
  return sender;
}

export async function sendInviteEmail(input: { inviteId: string; inviteUrl: string; email: string; role: Role; expiresAt: Date | string }): Promise<Delivery> {
  const subject = 'Seu convite para acessar a Alusa';
  const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
  if (!resend) {
    if (process.env.NODE_ENV === 'production') throw new Error('RESEND_API_KEY ausente em produção.');
    logEmail({ email: input.email, subject, inviteUrl: input.inviteUrl });
    return { delivery: 'logged', emailId: null };
  }
  try {
    const { data, error } = await resend.emails.send({
      from: getInviteSender(),
      to: [input.email],
      template: {
        id: INVITE_TEMPLATE_ID,
        variables: {
          ROLE: roleLabel(input.role),
          INVITE_URL: input.inviteUrl,
          INVITE_EXPIRES_AT: formatInviteExpiration(input.expiresAt),
          SUPPORT_URL: process.env.NEXT_PUBLIC_APP_URL || 'https://alusa.app',
        },
      },
      tags: [{ name: 'category', value: 'invite_user' }, { name: 'invite_id', value: input.inviteId }],
    }, { idempotencyKey: `invite-user/${input.inviteId}` });
    if (error) throw new Error(error.message);
    return { delivery: 'sent', emailId: data?.id ?? null };
  } catch (error) {
    if (process.env.NODE_ENV !== 'production' && !process.env.RESEND_API_KEY) {
      logEmail({ email: input.email, subject, inviteUrl: input.inviteUrl });
      return { delivery: 'logged', emailId: null };
    }
    throw error;
  }
}
