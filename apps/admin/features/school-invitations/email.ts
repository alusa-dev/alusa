import { Resend } from 'resend';

export async function sendSchoolInvitationEmail(input: { id: string; tokenHash: string; url: string; email: string; schoolName: string; expiresAt: Date }) {
  if (!process.env.RESEND_API_KEY) {
    if (process.env.NODE_ENV === 'production') throw Object.assign(new Error('School invitation email provider is not configured.'), { code: 'EMAIL_PROVIDER_NOT_CONFIGURED' });
    return { status: 'SKIPPED' as const, sentAt: null };
  }
  const from = process.env.EMAIL_FROM_INVITES || process.env.EMAIL_FROM_AUTH;
  if (!from) throw Object.assign(new Error('School invitation sender is not configured.'), { code: 'EMAIL_SENDER_NOT_CONFIGURED' });
  const resend = new Resend(process.env.RESEND_API_KEY);
  let result;
  try {
    result = await resend.emails.send({
      from,
      to: [input.email],
      subject: `Convite para configurar ${input.schoolName} na Alusa`,
      text: `Olá! Você recebeu um convite comercial para configurar ${input.schoolName} na Alusa. Acesse ${input.url} até ${input.expiresAt.toLocaleString('pt-BR')}. Se não esperava esta mensagem, ignore-a.`,
      html: `<p>Olá! Você recebeu um convite comercial para configurar <strong>${escapeHtml(input.schoolName)}</strong> na Alusa.</p><p><a href="${escapeHtml(input.url)}">Aceitar convite</a></p><p>O link expira em ${input.expiresAt.toLocaleString('pt-BR')}.</p><p>Se não esperava esta mensagem, ignore-a.</p>`,
      tags: [{ name: 'category', value: 'school_invitation' }, { name: 'invitation_id', value: input.id }],
    }, { idempotencyKey: `school-invitation/${input.id}/${input.tokenHash.slice(0, 24)}` });
  } catch {
    throw Object.assign(new Error('Email delivery could not be confirmed.'), { code: 'EMAIL_DELIVERY_AMBIGUOUS' });
  }
  if (result.error) throw Object.assign(new Error(result.error.message), { code: 'EMAIL_PROVIDER_REJECTED' });
  return { status: 'SENT' as const, sentAt: new Date() };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}
