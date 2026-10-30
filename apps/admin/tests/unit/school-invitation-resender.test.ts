import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getInvitationResendMessage, InvitationResendFeedback } from '@/features/school-invitations/InvitationResender';

describe('school invitation resend feedback', () => {
  it('keeps the new actionable link visible when email delivery is unconfirmed', () => {
    const message = getInvitationResendMessage('UNKNOWN');
    const markup = renderToStaticMarkup(createElement(InvitationResendFeedback, {
      message,
      url: 'https://alusa.test/convite-escola/new-token',
    }));

    expect(message).toContain('não foi confirmada');
    expect(message).toContain('continua válido');
    expect(markup).toContain('https://alusa.test/convite-escola/new-token');
    expect(markup).toContain('aria-label="Link atualizado do convite"');
  });
});
