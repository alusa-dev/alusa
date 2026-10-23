import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const claimsSchema = z.object({
  version: z.literal(1),
  accessId: z.string().min(1).max(128),
  contaId: z.string().min(1).max(128),
});

export type EventTicketScannerTokenClaims = z.infer<typeof claimsSchema>;

function signingKey() {
  const configured = process.env.EVENT_TICKET_SCANNER_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim();
  if (!configured || Buffer.byteLength(configured, 'utf8') < 32) {
    throw new Error('A chave de assinatura dos leitores precisa ter pelo menos 32 bytes.');
  }
  return createHmac('sha256', configured).update('alusa:event-ticket-scanner:v1').digest();
}

function signature(payload: string) {
  return createHmac('sha256', signingKey()).update(payload).digest();
}

export function createEventTicketScannerToken(input: { accessId: string; contaId: string }) {
  const payload = Buffer.from(JSON.stringify({ version: 1, ...input }), 'utf8').toString('base64url');
  return `${payload}.${signature(payload).toString('base64url')}`;
}

export function verifyEventTicketScannerToken(token: string): EventTicketScannerTokenClaims | null {
  const [payload, encodedSignature, extra] = token.split('.');
  if (!payload || !encodedSignature || extra !== undefined) return null;

  try {
    const expected = signature(payload);
    const provided = Buffer.from(encodedSignature, 'base64url');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const result = claimsSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
