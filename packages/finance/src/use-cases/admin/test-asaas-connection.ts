import {
  getMyAccountStatus,
  getSubaccount,
  listWebhooks,
} from '@alusa/asaas';
import { loadAsaasCredentials, prisma } from '@alusa/database';
import type { FinancialOnboardingStatus } from '@prisma/client';

import { classifyAsaasOperationalError } from '../../foundation/asaas-operational-error';
import { resolveWebhookUrl } from '../asaas-account/asaas-env';
import { getExplicitWebhookAuthToken, hasWebhookAuthTokenConfig } from '../asaas-account/webhook-auth-token.server';

type CheckStep = 'env' | 'auth' | 'account' | 'webhook';
export type CheckStatus = 'ok' | 'error' | 'skipped';

export type TesteAsaasErrorCode =
  | 'ASAAS_ENV_MISSING'
  | 'ASAAS_DISABLED'
  | 'ASAAS_AUTH_FAILED'
  | 'ASAAS_SUBACCOUNT_NOT_LINKED'
  | 'ASAAS_SUBACCOUNT_NOT_FOUND'
  | 'ASAAS_WEBHOOK_ENV_MISSING'
  | 'ASAAS_WEBHOOK_NOT_FOUND'
  | 'FORBIDDEN'
  | 'UNEXPECTED_ERROR';

export interface TesteAsaasFailure {
  success: false;
  summary: string;
  errorCode: TesteAsaasErrorCode;
  checks: Record<CheckStep, CheckStatus>;
  details: {
    step: CheckStep;
    message: string;
  };
  technical?: Record<string, unknown>;
}

export interface TesteAsaasSuccess {
  success: true;
  summary: string;
  checks: Record<CheckStep, CheckStatus>;
  technical?: Record<string, unknown>;
}

export type TesteAsaasResult = TesteAsaasSuccess | TesteAsaasFailure;

function toTrimmed(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function maskToken(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 8) return '***';
  return `${trimmed.slice(0, 4)}***${trimmed.slice(-4)}`;
}

function normalizeUrlBase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

function makeChecks(partial?: Partial<Record<CheckStep, CheckStatus>>): Record<CheckStep, CheckStatus> {
  return {
    env: partial?.env ?? 'skipped',
    auth: partial?.auth ?? 'skipped',
    account: partial?.account ?? 'skipped',
    webhook: partial?.webhook ?? 'skipped',
  };
}

function fail(params: {
  summary: string;
  errorCode: TesteAsaasErrorCode;
  step: CheckStep;
  message: string;
  checks: Record<CheckStep, CheckStatus>;
  technical?: Record<string, unknown>;
}): TesteAsaasFailure {
  return {
    success: false,
    summary: params.summary,
    errorCode: params.errorCode,
    checks: params.checks,
    details: {
      step: params.step,
      message: params.message,
    },
    technical: params.technical,
  };
}

function toOnboardingStatusFromAsaas(subaccountStatus: unknown): FinancialOnboardingStatus {
  if (typeof subaccountStatus === 'string') {
    const upper = subaccountStatus.trim().toUpperCase();
    if (
      upper === 'CREATED' ||
      upper === 'NOT_STARTED' ||
      upper === 'IN_PROGRESS' ||
      upper === 'UNDER_REVIEW' ||
      upper === 'APPROVED' ||
      upper === 'REJECTED'
    ) {
      return upper as FinancialOnboardingStatus;
    }
  }

  // White-label: se a subconta existe e responde, consideramos a integração validada.
  return 'APPROVED';
}

export async function testarConexaoAsaas(input: { contaId: string }): Promise<TesteAsaasResult> {
  const checks = makeChecks({ env: 'error', auth: 'skipped', account: 'skipped', webhook: 'skipped' });

  const baseUrl = toTrimmed(process.env.ASAAS_BASE_URL);
  const masterApiKey = toTrimmed(process.env.ASAAS_API_KEY);
  const enabled = process.env.FEATURE_ASAAS === 'true';

  if (!enabled) {
    return fail({
      summary: 'Integração com o Asaas está desabilitada.',
      errorCode: 'ASAAS_DISABLED',
      step: 'env',
      message: 'Ative a integração para executar o teste.',
      checks,
      technical: {
        featureAsaas: process.env.FEATURE_ASAAS ?? null,
      },
    });
  }

  if (!baseUrl || !masterApiKey) {
    return fail({
      summary: 'Configuração do Asaas incompleta.',
      errorCode: 'ASAAS_ENV_MISSING',
      step: 'env',
      message: 'As configurações necessárias do Asaas não foram encontradas.',
      checks,
      technical: {
        hasBaseUrl: !!baseUrl,
        hasMasterApiKey: !!masterApiKey,
      },
    });
  }

  checks.env = 'ok';

  // 2) Teste de autenticação (API Key master)
  try {
    await getMyAccountStatus({ apiKey: masterApiKey });
    checks.auth = 'ok';
  } catch (e) {
    checks.auth = 'error';
    const failure = classifyAsaasOperationalError(e, 'master');

    if (failure.category === 'invalid_master_credentials') {
      return fail({
        summary: 'Falha ao autenticar com o Asaas.',
        errorCode: 'ASAAS_AUTH_FAILED',
        step: 'auth',
        message: 'API Key inválida ou sem permissão.',
        checks,
        technical: {
          status: failure.status,
          category: failure.category,
          baseUrl: normalizeUrlBase(baseUrl),
        },
      });
    }

    return fail({
      summary: 'Falha ao autenticar com o Asaas.',
      errorCode: 'ASAAS_AUTH_FAILED',
      step: 'auth',
      message: 'Não foi possível validar a autenticação no Asaas.',
      checks,
      technical: {
        status: failure.status,
        category: failure.category,
        baseUrl: normalizeUrlBase(baseUrl),
        error: e instanceof Error ? e.message : String(e),
      },
    });
  }

  // 3) Validação de vínculo + leitura real via credencial da subconta
  const profile = await prisma.financeProfile.findUnique({
    where: { contaId: input.contaId },
    select: {
      id: true,
      asaasAccount: {
        select: {
          id: true,
          asaasAccountId: true,
          status: true,
          externalReference: true,
          apiKeyStatus: true,
          apiKeyEncrypted: true,
        },
      },
      asaasCredential: { select: { apiKeyEncrypted: true } },
    },
  });

  if (!profile) {
    checks.account = 'error';
    return fail({
      summary: 'Perfil financeiro não encontrado.',
      errorCode: 'ASAAS_SUBACCOUNT_NOT_LINKED',
      step: 'account',
      message: 'Não foi possível identificar o perfil financeiro desta conta.',
      checks,
      technical: {
        hasFinanceProfile: false,
      },
    });
  }

  const hasApiKey = Boolean(
    profile.asaasAccount?.apiKeyEncrypted ?? profile.asaasCredential?.apiKeyEncrypted,
  );

  const asaasAccountId = profile.asaasAccount?.asaasAccountId ?? null;

  if (!asaasAccountId) {
    checks.account = 'error';
    return fail({
      summary: 'Subconta do Asaas não está vinculada.',
      errorCode: 'ASAAS_SUBACCOUNT_NOT_LINKED',
      step: 'account',
      message: 'Não foi possível identificar a subconta vinculada a esta conta.',
      checks,
      technical: {
        hasFinanceProfile: true,
        financeStatus: profile.asaasAccount?.status ?? null,
        apiKeyStatus: profile.asaasAccount?.apiKeyStatus ?? null,
        hasApiKey,
      },
    });
  }

  const asaasAccountRowId = profile.asaasAccount?.id ?? null;
  if (!asaasAccountRowId) {
    checks.account = 'error';
    return fail({
      summary: 'Subconta do Asaas não está vinculada.',
      errorCode: 'ASAAS_SUBACCOUNT_NOT_LINKED',
      step: 'account',
      message: 'Não foi possível identificar o registro local de vínculo da subconta.',
      checks,
      technical: {
        asaasAccountIdMasked: maskToken(asaasAccountId),
        apiKeyStatus: profile.asaasAccount?.apiKeyStatus ?? null,
        hasApiKey,
      },
    });
  }

  let subaccount: unknown;
  try {
    subaccount = await getSubaccount({ apiKey: masterApiKey, accountId: asaasAccountId });
  } catch (e) {
    checks.account = 'error';
    const failure = classifyAsaasOperationalError(e, 'master');

    if (failure.category === 'subaccount_not_found') {
      return fail({
        summary: 'Vínculo com a subconta do Asaas parece quebrado.',
        errorCode: 'ASAAS_SUBACCOUNT_NOT_FOUND',
        step: 'account',
        message: 'A subconta vinculada não foi encontrada no Asaas.',
        checks,
        technical: {
          status: failure.status,
          category: failure.category,
          asaasAccountIdMasked: maskToken(asaasAccountId),
          apiKeyStatus: profile.asaasAccount?.apiKeyStatus ?? null,
          hasApiKey,
        },
      });
    }

    return fail({
      summary: 'Falha ao validar vínculo da subconta.',
      errorCode: 'ASAAS_SUBACCOUNT_NOT_FOUND',
      step: 'account',
      message: 'Não foi possível validar a subconta vinculada no Asaas.',
      checks,
      technical: {
        status: failure.status,
        category: failure.category,
        error: e instanceof Error ? e.message : String(e),
        asaasAccountIdMasked: maskToken(asaasAccountId),
        apiKeyStatus: profile.asaasAccount?.apiKeyStatus ?? null,
        hasApiKey,
      },
    });
  }

  // White-label: subconta válida se GET /accounts/{asaasAccountId} responde 200.
  // Também aproveitamos para religar o vínculo local se estiver incompleto.
  const desiredExternalReference = `financeProfile:${profile.id}`;
  const shouldSetExternalReference = !profile.asaasAccount?.externalReference;
  const conflict = shouldSetExternalReference
    ? await prisma.asaasAccount.findUnique({ where: { externalReference: desiredExternalReference }, select: { id: true } })
    : null;
  const canSetExternalReference = shouldSetExternalReference && (!conflict || conflict.id === asaasAccountRowId);

  const onboardingStatus = toOnboardingStatusFromAsaas((subaccount as { status?: unknown } | null)?.status);
  const now = new Date();

  const oldStatus = profile.asaasAccount?.status ?? null;
  const shouldUpdateStatus = oldStatus !== onboardingStatus;

  await prisma.$transaction(async (tx) => {
    await tx.asaasAccount.update({
      where: { id: asaasAccountRowId },
      data: {
        status: onboardingStatus,
        statusUpdatedAt: now,
        ...(canSetExternalReference ? { externalReference: desiredExternalReference } : {}),
      },
      select: { id: true },
    });

    if (shouldUpdateStatus) {
      await tx.asaasAccountStatusHistory.create({
        data: {
          asaasAccountId: asaasAccountRowId,
          oldStatus,
          newStatus: onboardingStatus,
          event: 'ADMIN_TEST',
          payloadId: 'GET:/accounts/{asaasAccountId}',
        },
        select: { id: true },
      });
    }
  });

  checks.account = 'ok';

  // 4) Webhook da subconta
  const webhookSecret = toTrimmed(process.env.ASAAS_WEBHOOK_AUTH_TOKEN_SECRET);
  const explicitWebhookToken = getExplicitWebhookAuthToken();
  const hasWebhookAuthConfig = hasWebhookAuthTokenConfig();
  let expectedWebhookUrl: string;
  try {
    expectedWebhookUrl = resolveWebhookUrl();
  } catch (error) {
    checks.webhook = 'error';
    return fail({
      summary: 'Configuração do webhook do Asaas incompleta.',
      errorCode: 'ASAAS_WEBHOOK_ENV_MISSING',
      step: 'webhook',
      message: 'Configure uma URL pública HTTPS para o webhook antes de validar a integração.',
      checks,
      technical: {
        error: error instanceof Error ? error.message : String(error),
        hasWebhookSecret: hasWebhookAuthConfig,
      },
    });
  }

  if (!hasWebhookAuthConfig) {
    checks.webhook = 'error';
    return fail({
      summary: 'Configuração do webhook do Asaas incompleta.',
      errorCode: 'ASAAS_WEBHOOK_ENV_MISSING',
      step: 'webhook',
      message: 'O token de autenticação do webhook não foi configurado.',
      checks,
      technical: {
        expectedWebhookUrl,
        hasWebhookSecret: false,
      },
    });
  }

  const subaccountCredentials = await loadAsaasCredentials(input.contaId);
  if (!subaccountCredentials?.apiKey) {
    checks.webhook = 'error';
    return fail({
      summary: 'Subconta do Asaas sem credencial operacional.',
      errorCode: 'ASAAS_SUBACCOUNT_NOT_LINKED',
      step: 'webhook',
      message: 'Não foi possível validar o webhook porque a API key da subconta não está disponível.',
      checks,
      technical: {
        expectedWebhookUrl,
        asaasAccountIdMasked: maskToken(asaasAccountId),
      },
    });
  }

  try {
    const webhooks = await listWebhooks({ apiKey: subaccountCredentials.apiKey, limit: 100, offset: 0 });
    const active = (webhooks.data ?? []).filter((w) => w.enabled !== false);
    const found = active.some((w) => normalizeUrlBase(w.url) === normalizeUrlBase(expectedWebhookUrl));

    if (!found) {
      checks.webhook = 'error';
      return fail({
        summary: 'Webhook do Asaas não está configurado.',
        errorCode: 'ASAAS_WEBHOOK_NOT_FOUND',
        step: 'webhook',
        message: 'Não encontramos um webhook ativo apontando para a URL correta.',
        checks,
        technical: {
          expectedWebhookUrl,
          checkedScope: 'subaccount',
          totalWebhooks: webhooks.data?.length ?? 0,
          activeWebhooks: active.length,
        },
      });
    }

    checks.webhook = 'ok';
  } catch (e) {
    checks.webhook = 'error';

    return fail({
      summary: 'Falha ao validar webhook do Asaas.',
      errorCode: 'ASAAS_WEBHOOK_NOT_FOUND',
      step: 'webhook',
      message: 'Não foi possível consultar os webhooks no Asaas.',
      checks,
      technical: {
        expectedWebhookUrl,
        checkedScope: 'subaccount',
        error: e instanceof Error ? e.message : String(e),
      },
    });
  }

  return {
    success: true,
    summary: 'Conexão com o Asaas validada com sucesso.',
    checks,
    technical: {
      baseUrl: normalizeUrlBase(baseUrl),
      expectedWebhookUrl,
      checkedScope: 'subaccount',
      asaasAccountIdMasked: maskToken(asaasAccountId),
      webhookTokenMasked: maskToken(explicitWebhookToken),
      webhookSecretMasked: maskToken(webhookSecret),
      updatedLocalLink: true,
      externalReferenceSet: canSetExternalReference,
      externalReferenceConflict: !!conflict && conflict.id !== asaasAccountRowId,
      apiKeyStatus: profile.asaasAccount?.apiKeyStatus ?? null,
      hasApiKey,
    },
  };
}
