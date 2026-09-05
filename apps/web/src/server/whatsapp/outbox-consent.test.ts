import { describe, expect, it } from 'vitest';

import { isWhatsAppOptOut } from './outbox.service';

describe('WhatsApp communication consent', () => {
  it.each(['SAIR', 'parar', 'STOP', 'cancela', 'REMOVER'])('recognizes %s as an opt-out command', (command) => {
    expect(isWhatsAppOptOut(command)).toBe(true);
  });

  it.each(['oi', 'aceito', 'quero receber', ''])('does not treat %s as opt-out', (body) => {
    expect(isWhatsAppOptOut(body)).toBe(false);
  });
});
