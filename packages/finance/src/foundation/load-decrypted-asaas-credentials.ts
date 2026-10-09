import { loadAsaasCredentials } from '@alusa/database';

/** Loads the connected tenant API key using the legacy event-flow source precedence. */
export async function loadDecryptedAsaasCredentials(
  contaId: string,
): Promise<{ apiKey: string; webhookSecret: string | null } | null> {
  const credentials = await loadAsaasCredentials(contaId);
  if (!credentials) return null;
  return { apiKey: credentials.apiKey, webhookSecret: credentials.webhookSecret };
}
