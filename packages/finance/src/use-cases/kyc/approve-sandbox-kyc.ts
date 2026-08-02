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
import { updateKycProcessStatus } from './kyc-persistence.service';

export type ApproveSandboxKycResult =
  | { success: true; generalStatus: string; alreadyRequested?: boolean }
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
    select: { id: true, asaasAccountId: true, kycProcess: { select: { status: true } } },
  });
  if (!asaasAccount) {
    return { success: false, reason: 'NO_ACCOUNT', message: 'Subconta Asaas não encontrada' };
  }

  if (asaasAccount.kycProcess?.status === 'APPROVED') {
    return { success: true, generalStatus: 'APPROVED', alreadyRequested: true };
  }

  const retryBefore = new Date(Date.now() - 2 * 60_000);
  const claim = await prisma.asaasAccount.updateMany({
    where: {
      id: asaasAccount.id,
      OR: [
        { sandboxApprovalRequestedAt: null },
        { sandboxApprovalRequestedAt: { lt: retryBefore } },
      ],
    },
    data: { sandboxApprovalRequestedAt: new Date() },
  });

  if (claim.count === 0) {
    return { success: true, generalStatus: 'AWAITING_APPROVAL', alreadyRequested: true };
  }

  let status;
  try {
    status = await approveSandboxAccount({ apiKey: creds.apiKey });
  } catch (err) {
    await prisma.asaasAccount.update({
      where: { id: asaasAccount.id },
      data: { sandboxApprovalRequestedAt: null },
      select: { id: true },
    }).catch(() => undefined);
    const msg = err instanceof Error ? err.message : 'Falha ao chamar sandbox/approve';
    return { success: false, reason: 'ASAAS_ERROR', message: msg };
  }

  // A resposta do próprio comando contém o snapshot oficial. Não fazemos um GET
  // imediato, que pode observar um estado intermediário durante a propagação.
  if (status.general?.toUpperCase() === 'APPROVED') {
    const syncedAt = new Date();
    await financeProfileService.syncRegulatoryState({
      contaId,
      asaasAccountId: asaasAccount.asaasAccountId,
      generalStatus: 'APPROVED',
      syncedAt,
      source: 'SANDBOX_COMMAND',
    });
    await updateKycProcessStatus({
      asaasAccountId: asaasAccount.id,
      status: 'APPROVED',
    });
  }

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
