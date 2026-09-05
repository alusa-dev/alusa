import { z } from 'zod';

const e164DigitsSchema = z.string().regex(/^\d{8,15}$/, 'Telefone deve estar em formato E.164.');

export function normalizeWhatsAppPhone(value: string): string {
  const digits = value.replace(/[^\d]/g, '');
  return e164DigitsSchema.parse(digits);
}

/** Normalizes Brazilian local numbers to the E.164 country-code form. */
export function normalizeBrazilianWhatsAppPhone(value: string): string {
  const digits = value.replace(/[^\d]/g, '');
  if (digits.startsWith('55')) return e164DigitsSchema.parse(digits);
  if (digits.length === 10 || digits.length === 11) return e164DigitsSchema.parse(`55${digits}`);
  return e164DigitsSchema.parse(digits);
}
