import { prisma } from '@alusa/database';
import type { AuditActorType, AsaasApiKeyStatus } from '@prisma/client';
import { getMyAccount } from '@alusa/asaas';

import { auditLogService } from '../../foundation/audit-log.service';
import { credentialVault } from '../../foundation/credential-vault';
import { validateSubaccountApiKey } from '../../foundation/asaas-api-key';

export type ReconnectAsaasResult =
  | { success: true; summary: string; apiKeyStatus: AsaasApiKeyStatus }
  | { success: false; summary: string; errorCode: 'INVALID_API_KEY' | 'NOT_LINKED' | 'ACCOUNT_MISMATCH' | 'UNEXPECTED_ERROR' };

export async function reconnectAsaasAccount(input: {
  contaId: string;
  apiKey: string;
  actor: { id?: string | null; type: AuditActorType };
}): Promise<ReconnectAsaasResult> {
  const apiKey = input.apiKey.trim();
  if (apiKey.length < 10) {
    return { success: false, summary: 'API key inválida.', errorCode: 'INVALID_API_KEY' };
  }

  const profile = await prisma.financeProfile.findUnique({
    where: { contaId: input.contaId },
    select: { id: true, asaasAccount: { select: { id: true, asaasAccountId: true } } },
  });

  if (!profile?.asaasAccount?.id) {
    return { success: false, summary: 'Subconta do Asaas não está vinculada.', errorCode: 'NOT_LINKED' };
  }

  const apiKeyStatus = await validateSubaccountApiKey(apiKey);
  if (apiKeyStatus !== 'CONNECTED') {
    return { success: false, summary: 'API key inválida ou sem permissão.', errorCode: 'INVALID_API_KEY' };
  }

  if (profile.asaasAccount.asaasAccountId) {
    const remoteAccount = await getMyAccount({ apiKey });
    if (remoteAccount.id && remoteAccount.id !== profile.asaasAccount.asaasAccountId) {
      return {
        success: false,
        summary: 'A API key informada pertence a outra conta Asaas.',
        errorCode: 'ACCOUNT_MISMATCH',
      };
    }
  }

  const encryptedApiKey = credentialVault.encrypt(apiKey);

  await prisma.$transaction(async (tx) => {
    await tx.asaasAccount.update({
      where: { id: profile.asaasAccount!.id },
      data: {
        apiKeyEncrypted: encryptedApiKey,
        apiKeyStatus: 'CONNECTED',
        status: 'CREATED',
        provisionLastError: null,
      },
      select: { id: true },
    });

    await tx.asaasCredential.upsert({
      where: { financeProfileId: profile.id },
      update: { apiKeyEncrypted: encryptedApiKey },
      create: { financeProfileId: profile.id, apiKeyEncrypted: encryptedApiKey },
      select: { id: true },
    });
  });

  await auditLogService.record({
    contaId: input.contaId,
    action: 'finance.asaas.reconnect',
    entity: { type: 'AsaasAccount', id: profile.asaasAccount.id },
    metadata: { apiKeyStatus: 'CONNECTED' },
    actor: input.actor.id ? { ...input.actor, id: input.actor.id } : { type: input.actor.type },
  });

  return { success: true, summary: 'Conta Asaas reconectada com sucesso.', apiKeyStatus: 'CONNECTED' };
}
