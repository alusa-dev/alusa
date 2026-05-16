import { getMyAccount } from '@alusa/asaas';
import { prisma } from '@alusa/database';
import {
  FinanceIntegrationMode,
  type AsaasApiKeyStatus,
  type AuditActorType,
} from '@prisma/client';

import { auditLogService } from '../../foundation/audit-log.service';
import { validateSubaccountApiKey } from '../../foundation/asaas-api-key';
import { credentialVault } from '../../foundation/credential-vault';
import { repairWebhookConfigDrift } from '../../webhooks/webhook-config-drift.service';
import { reconcileAsaasAccount } from '../asaas-account/reconcile-asaas-account';

export type SaveManualSubaccountApiKeyWarningCode = 'WEBHOOK_REPAIR_FAILED' | 'RECONCILE_FAILED';

export type SaveManualSubaccountApiKeyResult =
  | {
      ok: true;
      summary: string;
      apiKeyStatus: AsaasApiKeyStatus;
      asaasAccountId: string;
      webhook: { repaired: boolean; reason: string };
      reconcile: { reconciled: boolean; error: string | null };
      warnings: { code: SaveManualSubaccountApiKeyWarningCode; summary: string }[];
    }
  | {
      ok: false;
      summary: string;
      errorCode:
        | 'NO_CONTA'
        | 'NOT_WHITELABEL_BAAS'
        | 'NO_FINANCE_PROFILE'
        | 'NO_ASAAS_ACCOUNT'
        | 'NO_SUBACCOUNT_ID'
        | 'INVALID_API_KEY'
        | 'ACCOUNT_MISMATCH'
        | 'SAVE_FAILED';
    };

function sanitizeActor(actor: { type: AuditActorType; id?: string | null }) {
  const id = actor.id?.trim();
  return id ? { type: actor.type, id } : { type: actor.type };
}

export async function saveManualSubaccountApiKey(input: {
  contaId: string;
  apiKey: string;
  reason: string;
  actor: { type: AuditActorType; id?: string | null };
}): Promise<SaveManualSubaccountApiKeyResult> {
  const apiKey = input.apiKey.trim();
  const reason = input.reason.trim();
  const actor = sanitizeActor(input.actor);

  if (apiKey.length < 10) {
    return { ok: false, summary: 'API key inválida.', errorCode: 'INVALID_API_KEY' };
  }

  const conta = await prisma.conta.findUnique({
    where: { id: input.contaId },
    select: { id: true, financeIntegrationMode: true },
  });

  if (!conta) {
    return { ok: false, summary: 'Conta não encontrada.', errorCode: 'NO_CONTA' };
  }

  if (conta.financeIntegrationMode !== FinanceIntegrationMode.WHITELABEL_BAAS) {
    return {
      ok: false,
      summary: 'Esta ação só se aplica a escolas em modo white-label BaaS.',
      errorCode: 'NOT_WHITELABEL_BAAS',
    };
  }

  const profile = await prisma.financeProfile.findUnique({
    where: { contaId: input.contaId },
    select: {
      id: true,
      asaasAccountId: true,
      asaasAccount: {
        select: {
          id: true,
          asaasAccountId: true,
        },
      },
    },
  });

  if (!profile) {
    return {
      ok: false,
      summary: 'Perfil financeiro não encontrado.',
      errorCode: 'NO_FINANCE_PROFILE',
    };
  }

  const asaasAccount = profile.asaasAccount;
  if (!asaasAccount) {
    return {
      ok: false,
      summary: 'Conta Asaas local não encontrada. Faça o bootstrap local antes de salvar a chave.',
      errorCode: 'NO_ASAAS_ACCOUNT',
    };
  }

  const expectedAsaasAccountId = asaasAccount.asaasAccountId ?? profile.asaasAccountId ?? null;
  if (!expectedAsaasAccountId) {
    return {
      ok: false,
      summary:
        'Subconta Asaas ainda não está vinculada. Vincule o ID da subconta antes de salvar a chave.',
      errorCode: 'NO_SUBACCOUNT_ID',
    };
  }

  const apiKeyStatus = await validateSubaccountApiKey(apiKey);
  if (apiKeyStatus !== 'CONNECTED') {
    return {
      ok: false,
      summary: 'API key inválida ou sem permissão.',
      errorCode: 'INVALID_API_KEY',
    };
  }

  let remoteAccount;
  try {
    remoteAccount = await getMyAccount({ apiKey });
  } catch {
    return {
      ok: false,
      summary: 'API key inválida ou sem permissão.',
      errorCode: 'INVALID_API_KEY',
    };
  }

  if (remoteAccount.id !== expectedAsaasAccountId) {
    return {
      ok: false,
      summary: 'A API key informada pertence a outra subconta Asaas.',
      errorCode: 'ACCOUNT_MISMATCH',
    };
  }

  const encryptedApiKey = credentialVault.encrypt(apiKey);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.asaasAccount.update({
        where: { id: asaasAccount.id },
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
  } catch {
    return { ok: false, summary: 'Falha ao salvar a chave da subconta.', errorCode: 'SAVE_FAILED' };
  }

  await auditLogService.record({
    contaId: input.contaId,
    action: 'finance.asaas.save_manual_subaccount_api_key',
    entity: { type: 'AsaasAccount', id: asaasAccount.id },
    metadata: { apiKeyStatus: 'CONNECTED', asaasAccountId: expectedAsaasAccountId, reason },
    actor,
  });

  const warnings: { code: SaveManualSubaccountApiKeyWarningCode; summary: string }[] = [];
  let webhook = { repaired: false, reason: 'NO_DRIFT' };
  try {
    const repair = await repairWebhookConfigDrift({ contaId: input.contaId, actor });
    webhook = { repaired: repair.repaired, reason: repair.reason };
  } catch (error) {
    const summary =
      error instanceof Error ? error.message : 'Falha ao verificar ou reparar webhook.';
    warnings.push({ code: 'WEBHOOK_REPAIR_FAILED', summary });
    webhook = { repaired: false, reason: 'ERROR' };
  }

  let reconcile = { reconciled: false, error: null as string | null };
  try {
    const rec = await reconcileAsaasAccount({ contaId: input.contaId, actor, reason });
    reconcile = { reconciled: rec.reconciled, error: null };
  } catch (error) {
    const summary =
      error instanceof Error ? error.message : 'Falha ao reconciliar estado financeiro.';
    warnings.push({ code: 'RECONCILE_FAILED', summary });
    reconcile = { reconciled: false, error: summary };
  }

  const summaryParts = ['Chave validada e salva com segurança.'];
  if (webhook.reason === 'REPAIRED') summaryParts.push('Webhook reparado/alinhado.');
  else if (webhook.reason === 'NO_DRIFT') summaryParts.push('Webhook verificado.');
  if (reconcile.reconciled) summaryParts.push('Reconciliação concluída.');

  return {
    ok: true,
    summary: summaryParts.join(' '),
    apiKeyStatus: 'CONNECTED',
    asaasAccountId: expectedAsaasAccountId,
    webhook,
    reconcile,
    warnings,
  };
}
