import { describe, expect, it } from 'vitest';

import { normalizeBrazilianWhatsAppPhone, normalizeWhatsAppPhone } from './phone';

describe('WhatsApp phone normalization', () => {
  it('adds the Brazil country code to local 10 and 11 digit numbers', () => {
    expect(normalizeBrazilianWhatsAppPhone('(97) 98128-3106')).toBe('5597981283106');
  });

  it('preserves an existing country code', () => {
    expect(normalizeBrazilianWhatsAppPhone('+55 97 98128-3106')).toBe('5597981283106');
  });

  it('keeps generic E.164 normalization unchanged', () => {
    expect(normalizeWhatsAppPhone('+14155552671')).toBe('14155552671');
  });
});
