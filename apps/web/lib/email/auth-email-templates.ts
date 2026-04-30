type EmailTemplateInput = {
  recipientName?: string | null;
  actionUrl: string;
  expiresInLabel: string;
};

type InviteTemplateInput = {
  recipientName?: string | null;
  inviteUrl: string;
  roleLabel: string;
  invitedByName?: string | null;
  expiresInLabel: string;
};

type EmailTemplate = {
  subject: string;
  html: string;
  text: string;
};

function getGreeting(name?: string | null): string {
  return name?.trim() ? `Olá, ${name.trim()}` : 'Olá';
}

function wrapTemplate(title: string, intro: string, ctaLabel: string, actionUrl: string, outro: string): string {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#f5f1ea;padding:32px;color:#1d1d1d;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:20px;padding:32px;border:1px solid #eadfce;">
        <p style="margin:0 0 12px;font-size:14px;color:#7a6d5a;">alusa</p>
        <h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;color:#2c1f12;">${title}</h1>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3c3124;">${intro}</p>
        <a href="${actionUrl}" style="display:inline-block;padding:14px 22px;border-radius:12px;background:#3e1f63;color:#ffffff;text-decoration:none;font-weight:600;">${ctaLabel}</a>
        <p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#6f655a;">${outro}</p>
        <p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:#8e857b;word-break:break-all;">Se o botão não funcionar, copie e cole este link no navegador:<br />${actionUrl}</p>
      </div>
    </div>
  `;
}

export function buildVerifyEmailTemplate(input: EmailTemplateInput): EmailTemplate {
  const intro = `${getGreeting(input.recipientName)}, confirme seu e-mail para liberar o acesso completo à sua conta na alusa.`;
  const outro = `Este link expira em ${input.expiresInLabel}. Se você não criou esta conta, ignore este e-mail.`;

  return {
    subject: 'Confirme seu e-mail na alusa',
    html: wrapTemplate('Confirme seu e-mail', intro, 'Confirmar e-mail', input.actionUrl, outro),
    text: `${intro}\n\nConfirme aqui: ${input.actionUrl}\n\n${outro}`,
  };
}

export function buildAccountReactivationTemplate(input: EmailTemplateInput): EmailTemplate {
  const intro = `${getGreeting(input.recipientName)}, recebemos uma solicitação para reativar sua conta na alusa.`;
  const outro = `Este link expira em ${input.expiresInLabel}. Se você não solicitou a reativação, ignore este e-mail.`;

  return {
    subject: 'Reative sua conta na alusa',
    html: wrapTemplate('Reativar conta', intro, 'Reativar acesso', input.actionUrl, outro),
    text: `${intro}\n\nReative aqui: ${input.actionUrl}\n\n${outro}`,
  };
}

export function buildResetPasswordTemplate(input: EmailTemplateInput): EmailTemplate {
  const intro = `${getGreeting(input.recipientName)}, recebemos uma solicitação para redefinir sua senha.`;
  const outro = `Este link expira em ${input.expiresInLabel}. Se você não solicitou a redefinição, ignore este e-mail.`;

  return {
    subject: 'Redefina sua senha na alusa',
    html: wrapTemplate('Redefinir senha', intro, 'Criar nova senha', input.actionUrl, outro),
    text: `${intro}\n\nRedefina aqui: ${input.actionUrl}\n\n${outro}`,
  };
}

export function buildInviteUserTemplate(input: InviteTemplateInput): EmailTemplate {
  const inviter = input.invitedByName?.trim() ? ` por ${input.invitedByName.trim()}` : '';
  const intro = `${getGreeting(input.recipientName)}, você recebeu um convite${inviter} para acessar a alusa como ${input.roleLabel}.`;
  const outro = `Este convite expira em ${input.expiresInLabel}. Se você não reconhece este convite, ignore este e-mail.`;

  return {
    subject: 'Você recebeu um convite para acessar a alusa',
    html: wrapTemplate('Convite de acesso', intro, 'Aceitar convite', input.inviteUrl, outro),
    text: `${intro}\n\nAceite aqui: ${input.inviteUrl}\n\n${outro}`,
  };
}
