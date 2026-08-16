import { prisma } from '../client';
import {
  decryptSecretWithMetadata,
  encryptSecret,
  type DecryptedSecret,
} from '../security/encryption';

/**
 * Fonte de onde a API key foi carregada.
 */
export type AsaasCredentialSource = 'asaasAccount' | 'asaasCredential' | 'conta_legacy' | 'none';

export type AsaasCredentialHealth = 'CONNECTED' | 'MISSING' | 'DISCONNECTED' | 'DECRYPTION_FAILED';

export type AsaasCredentialInspection = {
  health: AsaasCredentialHealth;
  source: AsaasCredentialSource;
  fallbackUsed: boolean;
  encryptedSources: AsaasCredentialSource[];
  unreadableSources: AsaasCredentialSource[];
  apiKeyStatus: string | null;
};

type AsaasCredentialResolution = AsaasCredentialInspection & {
  apiKey: string | null;
  apiKeyEncrypted: string | null;
  apiKeyNeedsRotation: boolean;
  apiKeySourceId: string | null;
  webhookSecretEncrypted: string | null;
  webhookSecret: DecryptedSecret | null;
};

async function readCredentialSources(contaId: string) {
  const [profile, conta] = await Promise.all([
    prisma.financeProfile.findUnique({
      where: { contaId },
      select: {
        asaasCredential: { select: { id: true, apiKeyEncrypted: true } },
        asaasAccount: { select: { id: true, apiKeyEncrypted: true, apiKeyStatus: true } },
      },
    }),
    prisma.conta.findUnique({
      where: { id: contaId },
      select: { asaasApiKeyEncrypted: true, asaasWebhookSecretEncrypted: true },
    }),
  ]);

  return {
    candidates: [
      {
        source: 'asaasAccount' as const,
        sourceId: profile?.asaasAccount?.id ?? null,
        encrypted: profile?.asaasAccount?.apiKeyEncrypted ?? null,
        status: profile?.asaasAccount?.apiKeyStatus ?? null,
      },
      {
        source: 'asaasCredential' as const,
        sourceId: profile?.asaasCredential?.id ?? null,
        encrypted: profile?.asaasCredential?.apiKeyEncrypted ?? null,
        status: null,
      },
      {
        source: 'conta_legacy' as const,
        sourceId: contaId,
        encrypted: conta?.asaasApiKeyEncrypted ?? null,
        status: null,
      },
    ],
    webhookSecretEncrypted: conta?.asaasWebhookSecretEncrypted ?? null,
    canonicalApiKeyStatus: profile?.asaasAccount?.apiKeyStatus ?? null,
    canonicalAccountExists: Boolean(profile?.asaasAccount),
  };
}

async function resolveAsaasCredentials(contaId: string): Promise<AsaasCredentialResolution> {
  const { candidates, webhookSecretEncrypted, canonicalApiKeyStatus, canonicalAccountExists } =
    await readCredentialSources(contaId);
  const encryptedSources = candidates
    .filter((candidate) => candidate.encrypted)
    .map((candidate) => candidate.source);
  const unreadableSources: AsaasCredentialSource[] = [];

  for (const candidate of candidates) {
    if (!candidate.encrypted) continue;

    if (
      candidate.source === 'asaasAccount' &&
      candidate.status &&
      candidate.status !== 'CONNECTED'
    ) {
      return {
        health: 'DISCONNECTED',
        source: 'none',
        fallbackUsed: false,
        encryptedSources,
        unreadableSources,
        apiKeyStatus: candidate.status,
        apiKey: null,
        apiKeyEncrypted: candidate.encrypted,
        apiKeyNeedsRotation: false,
        apiKeySourceId: candidate.sourceId,
        webhookSecretEncrypted,
        webhookSecret: decryptSecretWithMetadata(webhookSecretEncrypted),
      };
    }

    const decryptedApiKey = decryptSecretWithMetadata(candidate.encrypted);
    if (!decryptedApiKey) {
      unreadableSources.push(candidate.source);
      continue;
    }

    const fallbackUsed = candidate.source !== 'asaasAccount';
    if (fallbackUsed) {
      console.warn('[loadAsaasCredentials] Fallback de credencial utilizado', {
        contaId,
        source: candidate.source,
        canonicalApiKeyStatus,
      });
    }

    return {
      health: 'CONNECTED',
      source: candidate.source,
      fallbackUsed,
      encryptedSources,
      unreadableSources,
        apiKeyStatus: candidate.source === 'asaasAccount' ? candidate.status : 'CONNECTED',
      apiKey: decryptedApiKey.value,
      apiKeyEncrypted: candidate.encrypted,
      apiKeyNeedsRotation: decryptedApiKey.needsRotation,
      apiKeySourceId: candidate.sourceId,
      webhookSecretEncrypted,
      webhookSecret: decryptSecretWithMetadata(webhookSecretEncrypted),
    };
  }

  const hasEncryptedSource = encryptedSources.length > 0;
  const canonicalStatus = canonicalApiKeyStatus;

  const canonicalIsDisconnected =
    canonicalAccountExists && Boolean(canonicalStatus) && canonicalStatus !== 'CONNECTED';

  return {
    health: canonicalIsDisconnected
      ? 'DISCONNECTED'
      : hasEncryptedSource
        ? 'DECRYPTION_FAILED'
        : 'MISSING',
    source: 'none',
    fallbackUsed: false,
    encryptedSources,
    unreadableSources,
    apiKeyStatus: canonicalStatus,
    apiKey: null,
    apiKeyEncrypted: null,
    apiKeyNeedsRotation: false,
    apiKeySourceId: null,
    webhookSecretEncrypted,
    webhookSecret: decryptSecretWithMetadata(webhookSecretEncrypted),
  };
}

async function rotateCredentialIfNeeded(contaId: string, resolution: AsaasCredentialResolution) {
  if (!resolution.apiKey || !resolution.apiKeyEncrypted || !resolution.apiKeyNeedsRotation) return;

  const encryptedApiKey = encryptSecret(resolution.apiKey);
  const where = { id: resolution.apiKeySourceId!, apiKeyEncrypted: resolution.apiKeyEncrypted };

  if (resolution.source === 'asaasAccount' && resolution.apiKeySourceId) {
    await prisma.asaasAccount.updateMany({ where, data: { apiKeyEncrypted: encryptedApiKey } });
  } else if (resolution.source === 'asaasCredential' && resolution.apiKeySourceId) {
    await prisma.asaasCredential.updateMany({ where, data: { apiKeyEncrypted: encryptedApiKey } });
  } else if (resolution.source === 'conta_legacy') {
    await prisma.conta.updateMany({
      where: { id: contaId, asaasApiKeyEncrypted: resolution.apiKeyEncrypted },
      data: { asaasApiKeyEncrypted: encryptedApiKey },
    });
  }
}

async function rotateWebhookSecretIfNeeded(contaId: string, resolution: AsaasCredentialResolution) {
  if (!resolution.webhookSecretEncrypted || !resolution.webhookSecret?.needsRotation) return;

  await prisma.conta.updateMany({
    where: { id: contaId, asaasWebhookSecretEncrypted: resolution.webhookSecretEncrypted },
    data: { asaasWebhookSecretEncrypted: encryptSecret(resolution.webhookSecret.value) },
  });
}

export async function inspectAsaasCredentials(contaId: string): Promise<AsaasCredentialInspection> {
  const resolution = await resolveAsaasCredentials(contaId);
  return {
    health: resolution.health,
    source: resolution.source,
    fallbackUsed: resolution.fallbackUsed,
    encryptedSources: resolution.encryptedSources,
    unreadableSources: resolution.unreadableSources,
    apiKeyStatus: resolution.apiKeyStatus,
  };
}

/**
 * Carrega credenciais descriptografadas do Asaas.
 *
 * Ordem de precedência (fonte canônica primeiro):
 * 1. AsaasAccount.apiKeyEncrypted (nova estrutura)
 * 2. AsaasCredential.apiKeyEncrypted (estrutura intermediária)
 * 3. Conta.asaasApiKeyEncrypted (legado)
 */
export async function loadAsaasCredentials(contaId: string) {
  const resolution = await resolveAsaasCredentials(contaId);

  if (resolution.health === 'DECRYPTION_FAILED') {
    console.error('[loadAsaasCredentials] Credencial criptografada não pôde ser descriptografada', {
      contaId,
      encryptedSources: resolution.encryptedSources,
      unreadableSources: resolution.unreadableSources,
      apiKeyStatus: resolution.apiKeyStatus,
    });
  }

  if (!resolution.apiKey || resolution.health !== 'CONNECTED') {
    return null;
  }

  try {
    await Promise.all([
      rotateCredentialIfNeeded(contaId, resolution),
      rotateWebhookSecretIfNeeded(contaId, resolution),
    ]);
  } catch (error) {
    // A falha de rotação não invalida uma credencial já descriptografada.
    // O compare-and-set mantém a operação idempotente e permite nova tentativa.
    console.warn('[loadAsaasCredentials] Rotação de credencial adiada', {
      contaId,
      source: resolution.source,
      error: error instanceof Error ? error.message : 'erro desconhecido',
    });
  }

  return {
    apiKey: resolution.apiKey,
    webhookSecret: resolution.webhookSecret?.value ?? null,
    apiKeyStatus: resolution.apiKeyStatus ?? 'CONNECTED',
    source: resolution.source,
  };
}

/**
 * Verifica se Asaas está habilitado para conta
 */
export async function isAsaasEnabled(contaId: string): Promise<boolean> {
  const inspection = await inspectAsaasCredentials(contaId);
  return inspection.health === 'CONNECTED';
}
