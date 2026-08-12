import { createHash } from 'node:crypto';

/**
 * Identificador estável e não sensível para os controles locais/distribuídos.
 * A chave nunca deve conter um fragmento da API key em logs ou Redis.
 */
export function createAsaasAccountKey(apiKey: string): string {
  return `asaas_${createHash('sha256').update(apiKey).digest('hex').slice(0, 24)}`;
}
