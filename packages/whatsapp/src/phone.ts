import { z } from 'zod';

const e164DigitsSchema = z.string().regex(/^\d{8,15}$/, 'Telefone deve estar em formato E.164.');

export function normalizeWhatsAppPhone(value: string): string {
  const digits = value.replace(/[^\d]/g, '');
  return e164DigitsSchema.parse(digits);
}
