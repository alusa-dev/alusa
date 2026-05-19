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
const DEFAULT_PREVIOUS_TOKEN_WINDOW_MS = 24 * 60 * 60 * 1000;

export type AsaasWebhookAuthTokenMatch = {
  contaId: string;
  tokenHash: string;
  tokenHashPrefix: string;
  matched: 'current' | 'previous';
  previousTokenExpiresAt: Date | null;
};

/**
 * Valida formato básico do token (rejeita tokens obviamente inválidos).
 */
export function isValidAsaasWebhookTokenFormat(token: string): boolean {
  if (token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) return false;
  // Rejeitar NUL bytes e caracteres de controle sem usar regex com control chars.
  for (const char of token) {
    const code = char.charCodeAt(0);
    if ((code >= 0x00 && code <= 0x08) || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f)) {
      return false;
    }
  }
  return true;
}

export function resolveAsaasWebhookAccessToken(headers: Pick<Headers, 'get'>): string | null {
  for (const header of ASAAS_WEBHOOK_TOKEN_HEADERS) {
    const value = headers.get(header);
    if (value && isValidAsaasWebhookTokenFormat(value)) return value;
  }

  return null;
}

/** Hash SHA-256 determinístico para payload de webhook ou outros inputs opacos. */
export function hashWebhookPayload(input: string): string {
  return sha256Hex(input);
}

/** Hash do token de autenticação do webhook (alias semântico de hashWebhookPayload). */
export function hashAsaasWebhookAccessToken(accessToken: string): string {
  return hashWebhookPayload(accessToken);
}

export function getAsaasWebhookTokenHashPrefix(accessToken: string | null | undefined): string | null {
  if (!accessToken || !isValidAsaasWebhookTokenFormat(accessToken)) return null;
  return hashAsaasWebhookAccessToken(accessToken).slice(0, 12);
}

function constantTimeHashEquals(storedHash: string | null | undefined, incomingHash: string): boolean {
  if (!storedHash) return false;
  const stored = Buffer.from(storedHash);
  const incoming = Buffer.from(incomingHash);
  if (stored.length !== incoming.length) return false;
  return timingSafeEqual(stored, incoming);
}

export async function authenticateAsaasWebhookToken(accessToken: string): Promise<AsaasWebhookAuthTokenMatch | null> {
  if (!isValidAsaasWebhookTokenFormat(accessToken)) return null;

  const tokenHash = sha256Hex(accessToken);
  const now = new Date();

  const asaasAccount = await prisma.asaasAccount.findFirst({
    where: {
      OR: [
        { webhookAuthTokenHash: tokenHash },
        {
          previousWebhookAuthTokenHash: tokenHash,
          previousWebhookAuthTokenExpiresAt: { gt: now },
        },
      ],
    },
    select: {
      webhookAuthTokenHash: true,
      previousWebhookAuthTokenHash: true,
      previousWebhookAuthTokenExpiresAt: true,
      financeProfile: {
        select: { contaId: true },
      },
    },
  });

  if (!asaasAccount) return null;

  if (constantTimeHashEquals(asaasAccount.webhookAuthTokenHash, tokenHash)) {
    return {
      contaId: asaasAccount.financeProfile.contaId,
      tokenHash,
      tokenHashPrefix: tokenHash.slice(0, 12),
      matched: 'current',
      previousTokenExpiresAt: null,
    };
  }

  if (
    asaasAccount.previousWebhookAuthTokenExpiresAt &&
    asaasAccount.previousWebhookAuthTokenExpiresAt > now &&
    constantTimeHashEquals(asaasAccount.previousWebhookAuthTokenHash, tokenHash)
  ) {
    return {
      contaId: asaasAccount.financeProfile.contaId,
      tokenHash,
      tokenHashPrefix: tokenHash.slice(0, 12),
      matched: 'previous',
      previousTokenExpiresAt: asaasAccount.previousWebhookAuthTokenExpiresAt,
    };
  }

  return null;
}

export async function resolveContaIdFromWebhookAuthToken(accessToken: string): Promise<string | null> {
  const auth = await authenticateAsaasWebhookToken(accessToken);
  return auth?.contaId ?? null;
}

export function getWebhookAuthRotationWindowMs(): number {
  const parsed = Number(process.env.ASAAS_WEBHOOK_PREVIOUS_TOKEN_WINDOW_MS ?? DEFAULT_PREVIOUS_TOKEN_WINDOW_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PREVIOUS_TOKEN_WINDOW_MS;
  return Math.floor(parsed);
}

export function buildWebhookAuthTokenRotationData(params: {
  currentHash: string | null | undefined;
  nextHash: string;
  now?: Date;
}): {
  webhookAuthTokenHash: string;
  previousWebhookAuthTokenHash?: string | null;
  previousWebhookAuthTokenExpiresAt?: Date | null;
} {
  if (!params.currentHash || params.currentHash === params.nextHash) {
    return { webhookAuthTokenHash: params.nextHash };
  }

  const now = params.now ?? new Date();
  return {
    webhookAuthTokenHash: params.nextHash,
    previousWebhookAuthTokenHash: params.currentHash,
    previousWebhookAuthTokenExpiresAt: new Date(now.getTime() + getWebhookAuthRotationWindowMs()),
  };
}
