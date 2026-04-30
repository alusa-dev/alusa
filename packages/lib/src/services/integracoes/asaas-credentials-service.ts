import { prisma } from '../../prisma';
import { encryptSecret, decryptSecret } from '../../security/encryption';

export interface AsaasCredentialsInput {
  apiKey: string;
  webhookSecret: string;
}

export interface AsaasCredentials {
  apiKeyMasked: string | null;
  webhookSecretMasked?: string | null;
  updatedAt: Date | null;
}

function mask(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 6) return '••••';
  return value.slice(0, 3) + '••••' + value.slice(-3);
}

export async function saveAsaasCredentials(
  contaId: string,
  input: AsaasCredentialsInput,
): Promise<void> {
  // Regras básicas: não armazenar vazio; permitir rotação puramente substituindo.
  if (!input.apiKey || !input.webhookSecret)
    throw new Error('apiKey e webhookSecret são obrigatórios');
  const apiKeyEncrypted = encryptSecret(input.apiKey.trim());
  const webhookEncrypted = encryptSecret(input.webhookSecret.trim());

  await prisma.conta.update({
    where: { id: contaId },
    data: {
      asaasApiKeyEncrypted: apiKeyEncrypted,
      asaasWebhookSecretEncrypted: webhookEncrypted,
      asaasCredsUpdatedAt: new Date(),
    },
  });
}

export async function getAsaasCredentials(contaId: string): Promise<AsaasCredentials> {
  const conta = await prisma.conta.findUnique({
    where: { id: contaId },
    select: {
      asaasApiKeyEncrypted: true,
      asaasWebhookSecretEncrypted: true,
      asaasCredsUpdatedAt: true,
    },
  });
  if (!conta) throw new Error('Conta não encontrada');
  return {
    apiKeyMasked: mask(decryptSecret(conta.asaasApiKeyEncrypted)),
    webhookSecretMasked: mask(decryptSecret(conta.asaasWebhookSecretEncrypted)),
    updatedAt: conta.asaasCredsUpdatedAt,
  };
}

// Novo: salvar apenas o token (API Key) sem webhook secret
export async function saveAsaasTokenOnly(contaId: string, token: string): Promise<void> {
  if (!token || token.trim().length < 10) throw new Error('Token inválido');
  const apiKeyEncrypted = encryptSecret(token.trim());

  await prisma.conta.update({
    where: { id: contaId },
    data: {
      asaasApiKeyEncrypted: apiKeyEncrypted,
      asaasCredsUpdatedAt: new Date(),
    },
  });
}

export async function loadDecryptedAsaasCredentials(
  contaId: string,
): Promise<{ apiKey: string; webhookSecret: string | null } | null> {
  const conta = await prisma.conta.findUnique({
    where: { id: contaId },
    select: {
      asaasApiKeyEncrypted: true,
      asaasWebhookSecretEncrypted: true,
    },
  });
  if (!conta) return null;
  const apiKey = decryptSecret(conta.asaasApiKeyEncrypted);
  // webhookSecret é opcional - token da API é suficiente para autenticação
  const webhookSecret = decryptSecret(conta.asaasWebhookSecretEncrypted);
  if (!apiKey) return null;
  return { apiKey, webhookSecret };
}
