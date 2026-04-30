/**
 * Verificador de token de webhook do Asaas
 * 
 * O Asaas envia o token no header `asaas-access-token`.
 * Devemos validar contra o hash armazenado em AsaasAccount.webhookAuthTokenHash.
 */

import { createHash, timingSafeEqual } from 'crypto';
import { AsaasGatewayError } from '../errors/asaas-gateway-error';

export type WebhookVerifyResult = {
  valid: boolean;
  contaId?: string;
  reason?: 'MISSING_TOKEN' | 'INVALID_TOKEN' | 'ACCOUNT_NOT_FOUND';
};

export type WebhookVerifierDeps = {
  findAsaasAccountByTokenHash: (tokenHash: string) => Promise<{
    financeProfile: { contaId: string };
    webhookAuthTokenHash: string;
  } | null>;
};

/**
 * Gera hash SHA256 de uma string
 */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Classe para verificação de tokens de webhook
 */
export class WebhookVerifier {
  constructor(private readonly deps: WebhookVerifierDeps) {}

  /**
   * Verifica se o token do webhook é válido
   */
  async verify(accessToken: string | null | undefined): Promise<WebhookVerifyResult> {
    if (!accessToken) {
      return { valid: false, reason: 'MISSING_TOKEN' };
    }

    const tokenHash = sha256Hex(accessToken);

    const asaasAccount = await this.deps.findAsaasAccountByTokenHash(tokenHash);

    if (!asaasAccount) {
      return { valid: false, reason: 'ACCOUNT_NOT_FOUND' };
    }

    // Constant-time compare (mesmo já tendo filtrado por hash)
    const stored = Buffer.from(asaasAccount.webhookAuthTokenHash);
    const incoming = Buffer.from(tokenHash);

    if (stored.length !== incoming.length) {
      return { valid: false, reason: 'INVALID_TOKEN' };
    }

    if (!timingSafeEqual(stored, incoming)) {
      return { valid: false, reason: 'INVALID_TOKEN' };
    }

    return {
      valid: true,
      contaId: asaasAccount.financeProfile.contaId,
    };
  }

  /**
   * Verifica e lança erro se inválido
   */
  async verifyOrThrow(accessToken: string | null | undefined): Promise<string> {
    const result = await this.verify(accessToken);

    if (!result.valid) {
      throw new AsaasGatewayError(
        `Webhook token inválido: ${result.reason}`,
        result.reason ?? 'INVALID_TOKEN',
        401
      );
    }

    return result.contaId!;
  }
}

/**
 * Extrai o token de webhook de uma request
 * Headers aceitos (em ordem de prioridade):
 * - asaas-access-token
 * - x-asaas-access-token
 * - access_token
 * - access-token
 */
export function extractWebhookToken(headers: {
  get(name: string): string | null;
}): string | null {
  const headerNames = [
    'asaas-access-token',
    'x-asaas-access-token',
    'access_token',
    'access-token',
  ];

  for (const name of headerNames) {
    const value = headers.get(name);
    if (value) return value;
  }

  return null;
}
