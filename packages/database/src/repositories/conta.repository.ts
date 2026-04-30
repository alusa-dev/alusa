import { prisma } from '../client';
import { decryptSecret } from '../security/encryption';

/**
 * Fonte de onde a API key foi carregada.
 */
export type AsaasCredentialSource = 'asaasAccount' | 'asaasCredential' | 'conta_legacy' | 'none';

/**
 * Carrega credenciais descriptografadas do Asaas.
 *
 * Ordem de precedência (fonte canônica primeiro):
 * 1. AsaasAccount.apiKeyEncrypted (nova estrutura)
 * 2. AsaasCredential.apiKeyEncrypted (estrutura intermediária)
 * 3. Conta.asaasApiKeyEncrypted (legado)
 */
export async function loadAsaasCredentials(contaId: string) {
  const [profile, conta] = await Promise.all([
    prisma.financeProfile.findUnique({
      where: { contaId },
      select: {
        asaasCredential: { select: { apiKeyEncrypted: true } },
        asaasAccount: { select: { apiKeyEncrypted: true, apiKeyStatus: true } },
      },
    }),
    prisma.conta.findUnique({
      where: { id: contaId },
      select: { asaasApiKeyEncrypted: true, asaasWebhookSecretEncrypted: true },
    }),
  ]);

  // Determinar fonte da API key
  let apiKeyEncrypted: string | null = null;
  let source: AsaasCredentialSource = 'none';

  if (profile?.asaasAccount?.apiKeyEncrypted) {
    apiKeyEncrypted = profile.asaasAccount.apiKeyEncrypted;
    source = 'asaasAccount';
  } else if (profile?.asaasCredential?.apiKeyEncrypted) {
    apiKeyEncrypted = profile.asaasCredential.apiKeyEncrypted;
    source = 'asaasCredential';
  } else if (conta?.asaasApiKeyEncrypted) {
    apiKeyEncrypted = conta.asaasApiKeyEncrypted;
    source = 'conta_legacy';
  }

  const apiKey = decryptSecret(apiKeyEncrypted);
  const apiKeyStatus = profile?.asaasAccount?.apiKeyStatus ?? (apiKey ? 'CONNECTED' : 'MISSING');

  if (!apiKey || apiKeyStatus !== 'CONNECTED') {
    return null;
  }

  // Observabilidade: logar quando usar fonte legada
  if (source === 'conta_legacy' || source === 'asaasCredential') {
    console.info('[loadAsaasCredentials] Usando fonte de credencial não-canônica', {
      contaId,
      source,
      hasAsaasAccount: Boolean(profile?.asaasAccount),
      hasAsaasCredential: Boolean(profile?.asaasCredential),
    });
  }

  const webhookSecret = decryptSecret(conta?.asaasWebhookSecretEncrypted);

  return { apiKey, webhookSecret, apiKeyStatus, source };
}

/**
 * Verifica se Asaas está habilitado para conta
 */
export async function isAsaasEnabled(contaId: string): Promise<boolean> {
  const profile = await prisma.financeProfile.findUnique({
    where: { contaId },
    select: {
      asaasCredential: { select: { id: true } },
      asaasAccount: { select: { apiKeyStatus: true, apiKeyEncrypted: true } },
    },
  });
  if (profile?.asaasAccount?.apiKeyEncrypted && profile.asaasAccount.apiKeyStatus === 'CONNECTED') {
    return true;
  }
  if (profile?.asaasCredential && !profile?.asaasAccount?.apiKeyStatus) return true;

  const conta = await prisma.conta.findUnique({ where: { id: contaId }, select: { asaasApiKeyEncrypted: true } });
  return !!conta?.asaasApiKeyEncrypted;
}
