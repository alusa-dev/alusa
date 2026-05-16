import { createSubaccountAccessToken, getMyAccount, AsaasHttpError } from '@alusa/asaas';
import { prisma } from '@alusa/database';
import { FinanceIntegrationMode, type AsaasApiKeyStatus, type AuditActorType } from '@prisma/client';

import { auditLogService } from '../../foundation/audit-log.service';
import { credentialVault } from '../../foundation/credential-vault';
import { validateSubaccountApiKey } from '../../foundation/asaas-api-key';
import { classifyAsaasOperationalError } from '../../foundation/asaas-operational-error';
import { MissingAsaasApiKeyError } from '../../errors/missing-asaas-api-key-error';
import { repairWebhookConfigDrift } from '../../webhooks/webhook-config-drift.service';
import { reconcileAsaasAccount } from '../asaas-account/reconcile-asaas-account';
import { getMasterAsaasApiKey } from '../asaas-account/asaas-env';

export type RecoverWhitelabelBaasResult =
  | {
      ok: true;
      summary: string;
      keyRestored: boolean;
      webhook: { repaired: boolean; reason: string };
      reconcile: { reconciled: boolean; error: string | null };
      warnings: string[];
    }
  | {
      ok: false;
      summary: string;
      errorCode:
        | 'NOT_WHITELABEL_BAAS'
        | 'NO_FINANCE_OR_CONTA'
        | 'NO_FINANCE_PROFILE'
        | 'NO_ASAAS_ACCOUNT'
        | 'NO_SUBACCOUNT_ID'
        | 'MASTER_KEY_MISSING'
        | 'ASAAS_BLOCKED_OR_UNAUTHORIZED'
        | 'ASAAS_ERROR'
        | 'KEY_VALIDATION_FAILED'
        | 'ACCOUNT_MISMATCH';
      status?: number | null;
    };

function needsSubaccountKeyRecovery(params: {
  apiKeyEncrypted: string | null | undefined;
  apiKeyStatus: AsaasApiKeyStatus;
}): boolean {
  if (!params.apiKeyEncrypted) return true;
  return params.apiKeyStatus !== 'CONNECTED';
}

/**
 * Recuperação white-label BaaS: gera API key da subconta via conta pai (ASAAS_API_KEY),
 * valida, persiste com cifra, repara webhooks quando possível e reconcilia estado local.
 *
 * Pré-requisitos Asaas: habilitar gestão de chaves de subcontas na UI master + whitelist de IP.
 */
export async function recoverWhitelabelBaasViaParentAccount(input: {
  contaId: string;
  reason: string;
  actor: { type: AuditActorType; id?: string | null };
}): Promise<RecoverWhitelabelBaasResult> {
  const reason = input.reason.trim();
  const actorId = input.actor.id?.trim() || undefined;

  const conta = await prisma.conta.findUnique({
    where: { id: input.contaId },
    select: { financeIntegrationMode: true },
  });

  if (!conta) {
    return { ok: false, summary: 'Conta não encontrada.', errorCode: 'NO_FINANCE_OR_CONTA' };
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
          apiKeyEncrypted: true,
          apiKeyStatus: true,
        },
      },
    },
  });

  if (!profile) {
    return { ok: false, summary: 'Perfil financeiro não encontrado.', errorCode: 'NO_FINANCE_PROFILE' };
  }

  const asaasAccount = profile.asaasAccount;
  if (!asaasAccount) {
    return {
      ok: false,
      summary: 'Conta Asaas local não encontrada. Conclua o onboarding antes de recuperar a integração.',
      errorCode: 'NO_ASAAS_ACCOUNT',
    };
  }

  const asaasAccountId = asaasAccount.asaasAccountId ?? profile.asaasAccountId ?? null;
  if (!asaasAccountId) {
    return {
      ok: false,
      summary: 'Subconta Asaas ainda não está vinculada. Conclua a criação da subconta antes.',
      errorCode: 'NO_SUBACCOUNT_ID',
    };
  }

  const mustRecoverKey = needsSubaccountKeyRecovery({
    apiKeyEncrypted: asaasAccount.apiKeyEncrypted,
    apiKeyStatus: asaasAccount.apiKeyStatus,
  });

  let keyRestored = false;
  let subaccountApiKey: string | undefined;

  if (mustRecoverKey) {
    let masterKey: string;
    try {
      masterKey = getMasterAsaasApiKey();
    } catch (error) {
      if (error instanceof MissingAsaasApiKeyError) {
        return {
          ok: false,
          summary: 'Chave da conta master Asaas (ASAAS_API_KEY) não está configurada no servidor.',
          errorCode: 'MASTER_KEY_MISSING',
        };
      }
      throw error;
    }

    const tokenName = `Alusa — recuperação suporte (${new Date().toISOString()})`;

    try {
      const created = await createSubaccountAccessToken({
        apiKey: masterKey,
        accountId: asaasAccountId,
        name: tokenName,
      });

      subaccountApiKey = created.apiKey;
    } catch (error) {
      const status = error instanceof AsaasHttpError ? error.status : null;
      const failure = classifyAsaasOperationalError(error, 'master');
      const blocked =
        failure.category === 'invalid_master_credentials' ||
        failure.category === 'subaccount_not_found';

      const message =
        status === 403 || status === 401
          ? 'Asaas recusou o pedido. Confirme a chave master, a autorização “Gestão de chaves de subcontas” ainda válida e os IPs permitidos.'
          : 'Não foi possível gerar a chave da subconta no Asaas. Tente novamente ou verifique o painel.';

      return {
        ok: false,
        summary: message,
        errorCode: blocked ? 'ASAAS_BLOCKED_OR_UNAUTHORIZED' : 'ASAAS_ERROR',
        status,
      };
    }

    if (!subaccountApiKey?.trim()) {
      return {
        ok: false,
        summary: 'Resposta do Asaas não trouxe a chave da subconta.',
        errorCode: 'ASAAS_ERROR',
      };
    }

    const status = await validateSubaccountApiKey(subaccountApiKey);
    if (status !== 'CONNECTED') {
      return {
        ok: false,
        summary: 'A chave gerada não pôde ser validada. Nada foi guardado.',
        errorCode: 'KEY_VALIDATION_FAILED',
      };
    }

    const remoteAccount = await getMyAccount({ apiKey: subaccountApiKey });
    if (remoteAccount.id && remoteAccount.id !== asaasAccountId) {
      return {
        ok: false,
        summary: 'A chave obtida não corresponde à subconta esperada desta escola. Nada foi guardado.',
        errorCode: 'ACCOUNT_MISMATCH',
      };
    }

    const encryptedApiKey = credentialVault.encrypt(subaccountApiKey);

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

    await auditLogService.record({
      contaId: input.contaId,
      action: 'finance.asaas.support_recover_via_parent',
      entity: { type: 'AsaasAccount', id: asaasAccount.id },
      metadata: { apiKeyStatus: 'CONNECTED', reason },
      actor: actorId ? { type: input.actor.type, id: actorId } : { type: input.actor.type },
    });

    keyRestored = true;
  }

  const warnings: string[] = [];

  let webhookRepaired = false;
  let webhookReason = 'NO_DRIFT';
  try {
    const repair = await repairWebhookConfigDrift({
      contaId: input.contaId,
      actor: actorId ? { type: input.actor.type, id: actorId } : { type: input.actor.type },
    });
    webhookRepaired = repair.repaired;
    webhookReason = repair.reason;
    if (repair.reason === 'CREDENTIALS_MISSING') {
      warnings.push('Webhooks: credenciais ainda indisponíveis após a operação.');
    }
    if (repair.reason !== 'REPAIRED' && repair.reason !== 'NO_DRIFT' && repair.reason !== 'CREDENTIALS_MISSING') {
      warnings.push(`Webhooks: ${repair.reason}`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Erro ao verificar webhooks.';
    warnings.push(`Webhooks: ${msg}`);
    webhookReason = 'ERROR';
  }

  let reconciled = false;
  let reconcileError: string | null = null;
  try {
    const rec = await reconcileAsaasAccount({
      contaId: input.contaId,
      actor: actorId ? { type: input.actor.type, id: actorId } : { type: input.actor.type },
      reason,
    });
    reconciled = rec.reconciled;
    if (!rec.reconciled && !rec.myAccountStatus) {
      warnings.push('Reconciliação: estado financeiro pode ainda não refletir o Asaas (sem status myAccount).');
    }
  } catch (error) {
    reconcileError = error instanceof Error ? error.message : 'Erro ao reconciliar com o Asaas.';
    warnings.push(`Reconciliação: ${reconcileError}`);
  }

  const summaryParts: string[] = [];
  if (keyRestored) summaryParts.push('Chave da subconta criada e guardada com segurança.');
  else summaryParts.push('Chave já estava ativa; webhooks e dados foram verificados.');

  if (webhookRepaired) summaryParts.push('Webhooks alinhados com a Alusa.');
  if (!warnings.length && !reconcileError) {
    summaryParts.push('Dados financeiros atualizados.');
  }

  return {
    ok: true,
    summary: summaryParts.join(' '),
    keyRestored,
    webhook: { repaired: webhookRepaired, reason: webhookReason },
    reconcile: { reconciled, error: reconcileError },
    warnings,
  };
}
