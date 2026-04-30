import { createHash, timingSafeEqual } from 'node:crypto';

import { prisma } from '@alusa/database';

export const ASAAS_WEBHOOK_TOKEN_HEADERS = [
  'asaas-access-token',
  'x-asaas-access-token',
  'access_token',
  'access-token',
] as const;

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

const MIN_TOKEN_LENGTH = 16;
const MAX_TOKEN_LENGTH = 512;

/**
 * Valida formato básico do token (rejeita tokens obviamente inválidos).
 */
function isValidTokenFormat(token: string): boolean {
  if (token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) return false;
  // Rejeitar NUL bytes e caracteres de controle
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(token)) return false;
  return true;
}

export function resolveAsaasWebhookAccessToken(headers: Pick<Headers, 'get'>): string | null {
  for (const header of ASAAS_WEBHOOK_TOKEN_HEADERS) {
    const value = headers.get(header);
    if (value && isValidTokenFormat(value)) return value;
  }

  return null;
}

export async function resolveContaIdFromWebhookAuthToken(accessToken: string): Promise<string | null> {
  const tokenHash = sha256Hex(accessToken);

  const asaasAccount = await prisma.asaasAccount.findFirst({
    where: { webhookAuthTokenHash: tokenHash },
    select: {
      webhookAuthTokenHash: true,
      financeProfile: {
        select: { contaId: true },
      },
    },
  });

  if (!asaasAccount?.webhookAuthTokenHash) return null;

  const stored = Buffer.from(asaasAccount.webhookAuthTokenHash);
  const incoming = Buffer.from(tokenHash);
  if (stored.length !== incoming.length) return null;
  if (!timingSafeEqual(stored, incoming)) return null;

  return asaasAccount.financeProfile.contaId;
}