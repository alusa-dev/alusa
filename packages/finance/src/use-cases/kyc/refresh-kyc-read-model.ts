import { loadAsaasCredentials, prisma } from '@alusa/database';

import { MissingAsaasApiKeyError } from '../../errors/missing-asaas-api-key-error';
import { buildCacheV2 } from './kyc-cache-utils';
import { getMyAccountDocumentsCached, getMyAccountStatusCached } from './kyc-asaas-read-cache';
import { syncKycModels } from './kyc-persistence.service';

export async function refreshKycReadModel(contaId: string): Promise<void> {
  const creds = await loadAsaasCredentials(contaId);
  if (!creds) {
    throw new MissingAsaasApiKeyError('Credenciais Asaas não encontradas para o tenant');
  }

  const asaasAccount = await prisma.asaasAccount.findFirst({
    where: { financeProfile: { contaId } },
    select: { id: true },
  });

  if (!asaasAccount?.id) return;

  const [documents, myAccountStatus] = await Promise.all([
    getMyAccountDocumentsCached({ apiKey: creds.apiKey }, { forceRefresh: true, intent: 'READ_MODEL' }),
    getMyAccountStatusCached({ apiKey: creds.apiKey }, { forceRefresh: true, intent: 'READ_MODEL' }),
  ]);

  const fetchedAt = new Date().toISOString();
  const cachePayload = buildCacheV2({
    myAccountStatus,
    documents,
    fetchedAt,
  });

  await prisma.asaasAccount.update({
    where: { id: asaasAccount.id },
    data: {
      documentsCache: cachePayload as unknown as object,
      documentsCacheUpdatedAt: new Date(),
    },
    select: { id: true },
  });

  await syncKycModels({
    asaasAccountId: asaasAccount.id,
    myAccountStatus,
    documents,
  }).catch(() => {
    // best-effort: o cache já foi atualizado acima
  });
}
