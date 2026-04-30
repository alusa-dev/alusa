/**
 * Use-case: approveSandboxKyc
 *
 * Aprova a conta Asaas no ambiente sandbox (POST /v3/sandbox/myAccount/approve).
 * Só executa se o ambiente for sandbox — em produção retorna erro explícito.
 *
 * Após aprovação:
 * - Invalida o cache de documentos (força fresh no próximo getKycSnapshot).
 * - Sincroniza regulatoryState.
 */

import {
  approveSandboxAccount,
  parseAsaasEnvironmentFromEnv,
} from '@alusa/asaas';
import { prisma, loadAsaasCredentials } from '@alusa/database';
import { Prisma } from '@prisma/client';

import { financeProfileService } from '../../foundation/finance-profile.service';
import { getMyAccountStatusCached } from './kyc-asaas-read-cache';

export type ApproveSandboxKycResult =
  | { success: true; generalStatus: string }
  | { success: false; reason: 'NOT_SANDBOX' | 'NO_CREDENTIALS' | 'NO_ACCOUNT' | 'ASAAS_ERROR'; message: string };

export async function approveSandboxKyc(contaId: string): Promise<ApproveSandboxKycResult> {
  const env = parseAsaasEnvironmentFromEnv();
  const baseUrl = (process.env.ASAAS_BASE_URL ?? '').toLowerCase();
  const isSandbox = env === 'sandbox' || (env === 'unknown' && baseUrl.includes('api-sandbox.asaas.com'));

  if (!isSandbox) {
    return { success: false, reason: 'NOT_SANDBOX', message: 'Operação disponível apenas em sandbox' };
  }

  const creds = await loadAsaasCredentials(contaId);
  if (!creds) {
    return { success: false, reason: 'NO_CREDENTIALS', message: 'Credenciais não encontradas' };
  }

  const fp = await prisma.financeProfile.findUnique({
    where: { contaId },
    select: { id: true },
  });
  if (!fp) {
    return { success: false, reason: 'NO_ACCOUNT', message: 'Perfil financeiro não encontrado' };
  }

  const asaasAccount = await prisma.asaasAccount.findUnique({
    where: { financeProfileId: fp.id },
    select: { id: true, asaasAccountId: true },
  });
  if (!asaasAccount) {
    return { success: false, reason: 'NO_ACCOUNT', message: 'Subconta Asaas não encontrada' };
  }

  try {
    await approveSandboxAccount({ apiKey: creds.apiKey });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Falha ao chamar sandbox/approve';
    return { success: false, reason: 'ASAAS_ERROR', message: msg };
  }

  // Confirmar via GET (read-after-write)
  const status = await getMyAccountStatusCached({ apiKey: creds.apiKey }, { forceRefresh: true });

  // Sincronizar regulatoryState
  await financeProfileService.syncRegulatoryState({
    contaId,
    asaasAccountId: asaasAccount.asaasAccountId,
    generalStatus: status.general,
    syncedAt: new Date(),
  });

  // Invalidar cache de documentos p/ forçar fresh
  await prisma.asaasAccount.update({
    where: { id: asaasAccount.id },
    data: {
      documentsCache: Prisma.JsonNull,
      documentsCacheUpdatedAt: null,
    },
    select: { id: true },
  });

  return { success: true, generalStatus: status.general ?? 'UNKNOWN' };
}
