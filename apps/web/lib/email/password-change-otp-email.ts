import { sendTransactionalEmail } from './transactional-email';

const PASSWORD_CHANGE_OTP_TEMPLATE_ID =
  process.env.RESEND_PASSWORD_CHANGE_OTP_TEMPLATE_ID?.trim() ||
  '26abaa1d-3973-4df3-89d9-2ba1bec30828';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export async function sendPasswordChangeOtpEmail(input: {
  challengeId: string;
  recipientName?: string | null;
  email: string;
  code: string;
  expiresInLabel: string;
}) {
  const name = input.recipientName?.trim() || 'você';
  const safeName = escapeHtml(name);
  const safeCode = escapeHtml(input.code);
  const subject = 'Seu código para alterar a senha na Alusa';
  const text = `Olá, ${name}. Seu código para alterar a senha na Alusa é ${input.code}. Ele expira em ${input.expiresInLabel}. Se você não solicitou essa alteração, ignore este e-mail.`;
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#f5f1ea;padding:32px;color:#1d1d1d;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:20px;padding:32px;border:1px solid #eadfce;">
        <p style="margin:0 0 12px;font-size:14px;color:#7a6d5a;">alusa</p>
        <h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;color:#2c1f12;">Código de segurança</h1>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3c3124;">Olá, ${safeName}. Use o código abaixo para confirmar a troca da sua senha:</p>
        <p style="margin:0 0 20px;text-align:center;font-size:32px;letter-spacing:10px;font-weight:700;color:#3e1f63;">${safeCode}</p>
        <p style="margin:0;font-size:13px;line-height:1.6;color:#6f655a;">O código expira em ${escapeHtml(input.expiresInLabel)}. Se você não solicitou essa alteração, ignore este e-mail.</p>
      </div>
    </div>
  `;

  return sendTransactionalEmail({
    to: input.email,
    from: process.env.EMAIL_FROM_AUTH || 'Alusa <convites@alusa.app>',
    subject,
    html,
    text,
    category: 'password_change_otp',
    idempotencyKey: `password-change-otp/${input.challengeId}`,
    template: PASSWORD_CHANGE_OTP_TEMPLATE_ID
      ? {
          id: PASSWORD_CHANGE_OTP_TEMPLATE_ID,
          variables: {
            RECIPIENT_NAME: name,
            OTP_CODE: input.code,
            EXPIRES_IN: input.expiresInLabel,
            SUPPORT_URL: process.env.EMAIL_SUPPORT_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://alusa.app',
          },
        }
      : undefined,
    tags: [
      { name: 'category', value: 'password_change_otp' },
      { name: 'challenge_id', value: input.challengeId },
    ],
  });
}
