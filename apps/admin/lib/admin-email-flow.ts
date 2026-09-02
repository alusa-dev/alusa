import { Resend } from 'resend';
import type { Role } from '@prisma/client';

type Delivery = { delivery: 'sent' | 'logged'; emailId: string | null };

function roleLabel(role: Role) {
  const labels: Partial<Record<Role, string>> = {
    ADMIN: 'administrador', PROFESSOR: 'professor', RECEPCAO: 'recepção',
    FINANCEIRO: 'financeiro', RESPONSAVEL: 'responsável',
  };
  return labels[role] ?? 'usuário';
}

function template(input: { inviteUrl: string; roleLabel: string; invitedByName?: string | null }) {
  const inviter = input.invitedByName?.trim() ? ` por ${input.invitedByName.trim()}` : '';
  const intro = `Olá, você recebeu um convite${inviter} para acessar a alusa como ${input.roleLabel}.`;
  const outro = 'Este convite expira em 7 dias. Se você não reconhece este convite, ignore este e-mail.';
  return {
    subject: 'Você recebeu um convite para acessar a alusa',
    html: `<div style="font-family:Arial,sans-serif;background:#f5f1ea;padding:32px;color:#1d1d1d"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:20px;padding:32px"><p style="color:#7a6d5a">alusa</p><h1>Convite de acesso</h1><p>${intro}</p><a href="${input.inviteUrl}" style="display:inline-block;padding:14px 22px;border-radius:12px;background:#3e1f63;color:#fff;text-decoration:none;font-weight:600">Aceitar convite</a><p>${outro}</p><p style="word-break:break-all">${input.inviteUrl}</p></div></div>`,
    text: `${intro}\n\nAceite aqui: ${input.inviteUrl}\n\n${outro}`,
  };
}

function logEmail(input: { email: string; subject: string; inviteUrl: string }) {
  console.info('[EMAIL][ADMIN_DEV_FALLBACK]', { to: input.email, subject: input.subject, actionUrl: input.inviteUrl });
}

export async function sendInviteEmail(input: { inviteId: string; inviteUrl: string; email: string; role: Role; invitedByName?: string | null }): Promise<Delivery> {
  const message = template({ inviteUrl: input.inviteUrl, roleLabel: roleLabel(input.role), invitedByName: input.invitedByName });
  const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
  if (!resend) {
    if (process.env.NODE_ENV === 'production') throw new Error('RESEND_API_KEY ausente em produção.');
    logEmail({ email: input.email, subject: message.subject, inviteUrl: input.inviteUrl });
    return { delivery: 'logged', emailId: null };
  }
  try {
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM_INVITES || process.env.EMAIL_FROM_AUTH || 'Alusa <onboarding@resend.dev>',
      to: [input.email], subject: message.subject, html: message.html, text: message.text,
      tags: [{ name: 'category', value: 'invite_user' }, { name: 'invite_id', value: input.inviteId }],
    }, { idempotencyKey: `invite-user/${input.inviteId}` });
    if (error) throw new Error(error.message);
    return { delivery: 'sent', emailId: data?.id ?? null };
  } catch (error) {
    if (process.env.NODE_ENV !== 'production' && (!process.env.RESEND_API_KEY || String(error).includes('testing emails'))) {
      logEmail({ email: input.email, subject: message.subject, inviteUrl: input.inviteUrl });
      return { delivery: 'logged', emailId: null };
    }
    throw error;
  }
}
