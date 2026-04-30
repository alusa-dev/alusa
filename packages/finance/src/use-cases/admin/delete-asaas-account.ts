import {
  AsaasHttpError,
  createSubaccountAccessToken,
  deleteMyAccount,
  deleteSubaccountAccessToken,
  getMyAccountStatus,
  getBalance,
  getWallets,
} from '@alusa/asaas';
import { prisma, loadAsaasCredentials } from '@alusa/database';
import { Prisma, type AuditActorType } from '@prisma/client';

import { classifyAsaasOperationalError } from '../../foundation/asaas-operational-error';
import { auditLogService } from '../../foundation/audit-log.service';
import { getMasterAsaasApiKey } from '../asaas-account/asaas-env';

export type DeleteAccountStepKey =
  | 'validate'
  | 'load'
  | 'subaccount_apikey'
  | 'precheck'
  | 'delete_asaas'
  | 'confirm_asaas'
  | 'delete_local'
  | 'audit';

export type DeleteAccountStepStatus = 'ok' | 'error' | 'skipped' | 'in_progress';

export type DeleteAsaasAccountErrorCode =
  | 'FORBIDDEN'
  | 'CONFIRM_TEXT_INVALID'
  | 'REMOVE_REASON_REQUIRED'
  | 'DESTRUCTIVE_ACTIONS_DISABLED'
  | 'FINANCE_PROFILE_NOT_FOUND'
  | 'ASAAS_ACCOUNT_NOT_LINKED'
  | 'ASAAS_SUBACCOUNT_APIKEY_MANAGEMENT_DISABLED'
  | 'ASAAS_SUBACCOUNT_APIKEY_CREATE_FAILED'
  | 'ASAAS_DELETE_NOT_ALLOWED'
  | 'ASAAS_DELETE_HAS_PENDING'
  | 'ASAAS_DELETE_FAILED'
  | 'LOCAL_DELETE_FAILED'
  | 'DELETE_ALREADY_IN_PROGRESS'
  | 'EXTERNAL_NOT_FOUND_INCONSISTENT'
  | 'UNEXPECTED_ERROR';

export type DeleteAsaasAccountStatus =
  | 'deleted'
  | 'deleting'
  | 'pending_external_delete'
  | 'deletion_failed_needs_admin';

export type DeleteAsaasAccountStep = {
  step: DeleteAccountStepKey;
  status: DeleteAccountStepStatus;
  message: string;
  debugSafe?: Record<string, unknown>;
};

export type DeleteAsaasAccountResult =
  | {
    success: true;
    status: DeleteAsaasAccountStatus;
    summary: string;
    asaasDeleted: boolean;
    localDeleted: boolean;
    steps: DeleteAsaasAccountStep[];
    debugSafe: Record<string, unknown>;
  }
  | {
    success: false;
    status: DeleteAsaasAccountStatus;
    summary: string;
    errorCode: DeleteAsaasAccountErrorCode;
    asaasDeleted: boolean;
    localDeleted: boolean;
    steps: DeleteAsaasAccountStep[];
    debugSafe?: Record<string, unknown>;
  };

type ResolveAsaasLinkErrorCode = 'MISSING_LOCAL_ASAAS_ACCOUNT_ID' | 'INVALID_LOCAL_ASAAS_ACCOUNT_ID';

type ResolveAsaasLinkProbe = {
  attempted: true;
  ok: boolean;
  httpStatus: number | null;
  inferredIdMasked: string | null;
};

class ResolveAsaasLinkError extends Error {
  constructor(
    public readonly code: ResolveAsaasLinkErrorCode,
    public readonly probe?: ResolveAsaasLinkProbe,
  ) {
    super(code);
    this.name = 'ResolveAsaasLinkError';
  }
}

function isValidAsaasAccountId(value: string): boolean {
  // IDs de subconta do Asaas tipicamente usam o prefixo `acc_`.
  // Aceitar somente esse padrão evita "lixo legado" / erro humano no fallback.
  return /^acc_[a-zA-Z0-9_-]+$/.test(value);
}

async function resolveAsaasLink(params: {
  contaId: string;
  financeProfileId: string;
  financeProfileAsaasAccountId: string | null;
  asaasAccount?: {
    id: string;
    asaasAccountId: string | null;
    deletedAsaasAccountId: string | null;
  } | null;
  actor: { type: AuditActorType; id?: string };
  requestId?: string;
}): Promise<{ id: string; asaasAccountId: string; repaired: boolean }> {
  // Fallback seguro: usa somente um ID externo já persistido localmente (FinanceProfile.asaasAccountId)
  // para reparar o vínculo quando estiver no formato esperado (acc_*). Não chama o Asaas aqui e não
  // altera a regra external-first; apenas evita um falso "não vinculado" quando o dado está em coluna legada.
  let candidate = toTrimmed(params.financeProfileAsaasAccountId);
  let source: 'FINANCE_PROFILE.asaasAccountId' | 'SUBACCOUNT_API_KEY' | null =
    candidate ? 'FINANCE_PROFILE.asaasAccountId' : null;
  const current = params.asaasAccount;
  const currentAsaasId = current?.asaasAccountId ?? current?.deletedAsaasAccountId ?? null;

  if (current?.id && currentAsaasId) {
    return { id: current.id, asaasAccountId: currentAsaasId, repaired: false };
  }

  // Novo fallback: se não existe ID no banco, mas existe API key local da subconta,
  // usar endpoint read-only (/myAccount/status) para inferir o accountId e reparar o vínculo.
  // Isso não altera external-first: apenas preenche o vínculo local para permitir a exclusão seguir.
  if (!candidate) {
    const creds = await loadAsaasCredentials(params.contaId);
    if (creds?.apiKey) {
      try {
        const status = await getMyAccountStatus({ apiKey: creds.apiKey });
        const inferredId = toTrimmed(status.id ?? undefined);

        if (!inferredId) {
          throw new ResolveAsaasLinkError('MISSING_LOCAL_ASAAS_ACCOUNT_ID', {
            attempted: true,
            ok: false,
            httpStatus: 200,
            inferredIdMasked: null,
          });
        }

        if (!isValidAsaasAccountId(inferredId)) {
          throw new ResolveAsaasLinkError('INVALID_LOCAL_ASAAS_ACCOUNT_ID', {
            attempted: true,
            ok: false,
            httpStatus: 200,
            inferredIdMasked: maskToken(inferredId),
          });
        }

        candidate = inferredId;
        source = 'SUBACCOUNT_API_KEY';
      } catch (error) {
        const httpStatus = error instanceof AsaasHttpError ? error.status : null;

        if (error instanceof ResolveAsaasLinkError) {
          throw error;
        }

        throw new ResolveAsaasLinkError('MISSING_LOCAL_ASAAS_ACCOUNT_ID', {
          attempted: true,
          ok: false,
          httpStatus,
          inferredIdMasked: null,
        });
      }
    }

    // Fallback 2: Recuperar via Master Key (getWallets)
    try {
      const conta = await prisma.conta.findUnique({
        where: { id: params.contaId },
        select: { cpfCnpj: true },
      });

      const cpfCnpj = conta?.cpfCnpj?.replace(/\D/g, '');
      if (cpfCnpj) {
        const masterKey = getMasterAsaasApiKey();
        const wallets = await getWallets({ apiKey: masterKey, cpfCnpj, limit: 1 });

        if (wallets.data && wallets.data.length > 0) {
          candidate = wallets.data[0].id;
          source = 'SUBACCOUNT_API_KEY';

          console.info('[admin.delete-account][asaas] WALLET_RECOVERED_VIA_MASTER', {
            requestId: params.requestId,
            contaId: params.contaId,
            recoveredIdMasked: maskToken(candidate),
          });
        }
      }
    } catch (err) {
      console.warn('[admin.delete-account][asaas] WALLET_RECOVERY_FAILED', {
        error: err instanceof Error ? err.message : String(err),
        contaId: params.contaId,
      });
    }
  }

  if (!candidate) {
    throw new ResolveAsaasLinkError('MISSING_LOCAL_ASAAS_ACCOUNT_ID');
  }

  if (!isValidAsaasAccountId(candidate)) {
    throw new ResolveAsaasLinkError('INVALID_LOCAL_ASAAS_ACCOUNT_ID');
  }

  const now = new Date();
  const repaired = await prisma.$transaction(async (tx) => {
    if (!current?.id) {
      const created = await tx.asaasAccount.create({
        data: {
          financeProfileId: params.financeProfileId,
          asaasAccountId: candidate,
          status: 'CREATED',
          statusUpdatedAt: now,
          documentsCache: Prisma.DbNull,
          documentsCacheUpdatedAt: null,
        },
        select: { id: true },
      });

      return { id: created.id, repaired: true };
    }

    await tx.asaasAccount.update({
      where: { id: current.id },
      data: {
        asaasAccountId: candidate,
        status: current.asaasAccountId ? undefined : 'CREATED',
        statusUpdatedAt: current.asaasAccountId ? undefined : now,
      },
      select: { id: true },
    });

    return { id: current.id, repaired: true };
  });

  if (repaired.repaired) {
    try {
      console.info('[admin.delete-account][asaas] ASAAS_LINK_REPAIRED', {
        requestId: params.requestId ?? null,
        contaId: params.contaId,
        financeProfileId: params.financeProfileId,
        asaasAccountIdMasked: maskToken(candidate),
        source: source ?? 'unknown',
      });
    } catch {
      // noop
    }

    await auditLogService.record({
      contaId: params.contaId,
      action: 'finance.admin.asaas_link_repaired',
      entity: { type: 'FinanceProfile', id: params.financeProfileId },
      metadata: { asaasAccountId: candidate, source: source ?? 'unknown' },
      actor: params.actor,
    });
  }

  return { id: repaired.id, asaasAccountId: candidate, repaired: true };
}

function toTrimmed(value: string | null | undefined): string | null {
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

function pushStep(
  steps: DeleteAsaasAccountStep[],
  step: DeleteAccountStepKey,
  status: DeleteAccountStepStatus,
  message: string,
  debugSafe?: Record<string, unknown>,
) {
  steps.push({ step, status, message, ...(debugSafe ? { debugSafe } : {}) });
}

function isSandboxBaseUrl(baseUrl: string | null): boolean {
  const normalized = baseUrl ? normalizeUrlBase(baseUrl).toLowerCase() : '';
  return normalized.includes('sandbox') || normalized.includes('api-sandbox');
}

function extractAsaasErrors(response: unknown): Array<{ code?: string; description?: string }> {
  if (!response || typeof response !== 'object') return [];
  const obj = response as { errors?: unknown };
  if (!Array.isArray(obj.errors)) return [];

  return obj.errors
    .flatMap((e) => {
      if (!e || typeof e !== 'object') return [];
      const rec = e as Record<string, unknown>;
      const code = typeof rec.code === 'string' ? rec.code : undefined;
      const description = typeof rec.description === 'string' ? rec.description : undefined;

      if (!code && !description) return [];
      return [{ ...(code ? { code } : {}), ...(description ? { description } : {}) }];
    })
    .filter((x) => x);
}

function shouldRetryAsaasStatus(status: number | null): boolean {
  if (!status) return false;
  return classifyAsaasOperationalError({ status }, 'subaccount').retryable;
}

function isAsaasDeleteConfirmation(error: unknown): boolean {
  const failure = classifyAsaasOperationalError(error, 'subaccount');
  return (
    failure.category === 'invalid_subaccount_credentials' ||
    failure.category === 'myaccount_not_found'
  );
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitterMs(baseMs: number): number {
  const variance = baseMs * 0.2;
  const delta = (Math.random() * 2 - 1) * variance;
  return Math.max(0, Math.round(baseMs + delta));
}

function computeBackoffMs(attempt: number): number {
  // attempt: 1..N
  const base = Math.min(10_000, 250 * 2 ** (attempt - 1));
  return jitterMs(base);
}

async function withAsaasRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { maxAttempts: number },
): Promise<{ value?: T; error?: unknown; attempts: number; elapsedMs: number }> {
  const startedAt = Date.now();
  let lastError: unknown = undefined;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      const value = await fn(attempt);
      return { value, attempts: attempt, elapsedMs: Date.now() - startedAt };
    } catch (err) {
      lastError = err;
      const status = err instanceof AsaasHttpError ? err.status : null;
      if (!shouldRetryAsaasStatus(status) || attempt === opts.maxAttempts) {
        return { error: err, attempts: attempt, elapsedMs: Date.now() - startedAt };
      }
      await sleep(computeBackoffMs(attempt));
    }
  }

  return { error: lastError, attempts: opts.maxAttempts, elapsedMs: Date.now() - startedAt };
}

function safeAsaasLogContext(input: {
  financeProfileId: string;
  contaId: string;
  asaasAccountId: string | null;
  accessTokenId: string | null;
  requestId?: string;
  operation: 'REVOKE_KEY' | 'DELETE_SUBACCOUNT';
  httpStatus?: number | null;
  errors?: Array<{ code?: string; description?: string }>;
  attempts?: number;
  elapsedMs?: number;
}) {
  return {
    requestId: input.requestId ?? null,
    contaId: input.contaId,
    financeProfileId: input.financeProfileId,
    asaasAccountIdMasked: maskToken(input.asaasAccountId),
    accessTokenIdMasked: maskToken(input.accessTokenId),
    operation: input.operation,
    httpStatus: input.httpStatus ?? null,
    errors: input.errors ?? [],
    retries: typeof input.attempts === 'number' ? Math.max(0, input.attempts - 1) : null,
    elapsedMs: input.elapsedMs ?? null,
  };
}

async function confirmMyAccountDisabled(params: {
  apiKey: string;
  maxAttempts: number;
}): Promise<{ ok: boolean; lastHttpStatus: number | null }> {
  // Após DELETE /myAccount, o comportamento esperado é a API key da subconta deixar de funcionar.
  // Confirmamos de forma best-effort chamando GET /myAccount/status.
  for (let attempt = 1; attempt <= params.maxAttempts; attempt++) {
    try {
      await getMyAccountStatus({ apiKey: params.apiKey });
      // Ainda respondeu 200 -> aguardar e tentar novamente
      if (attempt < params.maxAttempts) {
        await sleep(computeBackoffMs(attempt));
        continue;
      }
      return { ok: false, lastHttpStatus: 200 };
    } catch (err) {
      const status = err instanceof AsaasHttpError ? err.status : null;

      // Sinais fortes de que a subconta foi desabilitada/excluída (apiKey inválida / recurso inacessível)
      if (isAsaasDeleteConfirmation(err)) {
        return { ok: true, lastHttpStatus: status };
      }

      if (shouldRetryAsaasStatus(status) && attempt < params.maxAttempts) {
        await sleep(computeBackoffMs(attempt));
        continue;
      }

      return { ok: false, lastHttpStatus: status };
    }
  }

  return { ok: false, lastHttpStatus: null };
}

async function persistIntegrationLog(params: {
  contaId: string;
  financeProfileId: string;
  asaasAccountId: string | null;
  operation: 'REVOKE_KEY' | 'DELETE_SUBACCOUNT';
  status: 'SUCCESS' | 'ERROR';
  httpStatus?: number | null;
  request: Record<string, unknown>;
  response?: Record<string, unknown> | null;
  errorMessage?: string | null;
  durationMs?: number;
}) {
  const tipoOperacao =
    params.operation === 'REVOKE_KEY' ? 'ASAAS_REVOKE_SUBACCOUNT_KEY' : 'ASAAS_DELETE_SUBACCOUNT';

  await prisma.logIntegracao.create({
    data: {
      contaId: params.contaId,
      tipoOperacao,
      entidade: 'FINANCE_PROFILE',
      entidadeId: params.financeProfileId,
      asaasId: params.asaasAccountId,
      status: params.status,
      httpStatus: params.httpStatus ?? null,
      request: params.request as Prisma.InputJsonValue,
      response:
        params.response === undefined
          ? undefined
          : params.response === null
            ? Prisma.JsonNull
            : (params.response as Prisma.InputJsonValue),
      errorMessage: params.errorMessage ?? null,
      duration: params.durationMs ?? null,
      idempotencyKey: null,
    },
    select: { id: true },
  });
}

export async function excluirContaAlusaEAsaas(input: {
  contaId?: string;
  financeProfileId?: string;
  confirmText: string;
  removeReason: string;
  actor: { type: AuditActorType; id?: string };
  requestId?: string;
}): Promise<DeleteAsaasAccountResult> {
  const steps: DeleteAsaasAccountStep[] = [];

  const baseUrl = toTrimmed(process.env.ASAAS_BASE_URL);
  const allowDestructive = process.env.ALLOW_DESTRUCTIVE_ACTIONS === 'true' || isSandboxBaseUrl(baseUrl);

  if (input.confirmText !== 'DELETAR') {
    pushStep(steps, 'validate', 'error', 'Confirmação inválida.');
    return {
      success: false,
      status: 'deletion_failed_needs_admin',
      summary: 'Você precisa digitar DELETAR para confirmar.',
      errorCode: 'CONFIRM_TEXT_INVALID',
      asaasDeleted: false,
      localDeleted: false,
      steps,
    };
  }

  if (!input.removeReason?.trim()) {
    pushStep(steps, 'validate', 'error', 'Motivo é obrigatório.');
    return {
      success: false,
      status: 'deletion_failed_needs_admin',
      summary: 'Informe um motivo para a exclusão.',
      errorCode: 'REMOVE_REASON_REQUIRED',
      asaasDeleted: false,
      localDeleted: false,
      steps,
    };
  }

  if (!allowDestructive) {
    pushStep(steps, 'validate', 'error', 'Ações destrutivas desabilitadas.');
    return {
      success: false,
      status: 'deletion_failed_needs_admin',
      summary: 'Ações destrutivas estão desabilitadas neste ambiente.',
      errorCode: 'DESTRUCTIVE_ACTIONS_DISABLED',
      asaasDeleted: false,
      localDeleted: false,
      steps,
      debugSafe: {
        ...(baseUrl ? { baseUrl: normalizeUrlBase(baseUrl) } : {}),
        allowDestructive,
      },
    };
  }

  pushStep(steps, 'validate', 'ok', 'Validações iniciais OK.');

  // 1) Buscar vínculo local (financeProfile + asaasAccount)
  pushStep(steps, 'load', 'in_progress', 'Carregando vínculo local…');

  const profile = input.financeProfileId
    ? await prisma.financeProfile.findUnique({
      where: { id: input.financeProfileId },
      select: { id: true, contaId: true, asaasAccountId: true },
    })
    : input.contaId
      ? await prisma.financeProfile.findUnique({
        where: { contaId: input.contaId },
        select: { id: true, contaId: true, asaasAccountId: true },
      })
      : null;

  if (!profile) {
    pushStep(steps, 'load', 'error', 'FinanceProfile não encontrado.');
    return {
      success: false,
      status: 'deletion_failed_needs_admin',
      summary: 'FinanceProfile não encontrado para essa conta.',
      errorCode: 'FINANCE_PROFILE_NOT_FOUND',
      asaasDeleted: false,
      localDeleted: false,
      steps,
    };
  }

  const conta = await prisma.conta.findUnique({
    where: { id: profile.contaId },
    select: { id: true, status: true, deletedAt: true },
  });

  if (!conta) {
    pushStep(steps, 'load', 'error', 'Conta não encontrada.');
    return {
      success: false,
      status: 'deletion_failed_needs_admin',
      summary: 'Conta não encontrada.',
      errorCode: 'FINANCE_PROFILE_NOT_FOUND',
      asaasDeleted: false,
      localDeleted: false,
      steps,
      debugSafe: { financeProfileId: profile.id },
    };
  }

  let asaasAccount = await prisma.asaasAccount.findUnique({
    where: { financeProfileId: profile.id },
    select: {
      id: true,
      asaasAccountId: true,
      deletedAsaasAccountId: true,
      externalReference: true,
      status: true,
      deletionState: true,
      deletedExternallyAt: true,
      deletedLocallyAt: true,
      deletionAttempts: true,
    },
  });

  let resolveFailure: { code: ResolveAsaasLinkErrorCode; probe?: ResolveAsaasLinkProbe } | null = null;
  let resolved: { id: string; asaasAccountId: string; repaired: boolean } | null = null;
  try {
    resolved = await resolveAsaasLink({
      contaId: profile.contaId,
      financeProfileId: profile.id,
      financeProfileAsaasAccountId: profile.asaasAccountId ?? null,
      asaasAccount: asaasAccount
        ? {
          id: asaasAccount.id,
          asaasAccountId: asaasAccount.asaasAccountId,
          deletedAsaasAccountId: asaasAccount.deletedAsaasAccountId,
        }
        : null,
      actor: input.actor,
      requestId: input.requestId,
    });
  } catch (error) {
    if (error instanceof ResolveAsaasLinkError) {
      resolveFailure = {
        code: error.code,
        ...(error.probe ? { probe: error.probe } : {}),
      };
    }
  }

  if (!resolved) {
    const asaasAccountId = asaasAccount?.asaasAccountId ?? asaasAccount?.deletedAsaasAccountId ?? null;
    const failureCode = resolveFailure ? resolveFailure.code : null;
    const probe = resolveFailure?.probe;
    const details =
      failureCode === 'INVALID_LOCAL_ASAAS_ACCOUNT_ID'
        ? 'ID legado inválido.'
        : failureCode === 'MISSING_LOCAL_ASAAS_ACCOUNT_ID'
          ? 'ID local ausente.'
          : 'Sem vínculo local.';

    const probeDetails = probe?.attempted
      ? ` Probe via API key falhou${probe.httpStatus ? ` (HTTP ${probe.httpStatus})` : ''}.`
      : '';

    pushStep(steps, 'load', 'error', `AsaasAccount não vinculado. ${details}${probeDetails}`);
    return {
      success: false,
      status: 'deletion_failed_needs_admin',
      summary: 'A subconta do Asaas não está vinculada localmente.',
      errorCode: 'ASAAS_ACCOUNT_NOT_LINKED',
      asaasDeleted: false,
      localDeleted: false,
      steps,
      debugSafe: {
        financeProfileId: profile.id,
        ...(resolveFailure ? { linkFailure: resolveFailure } : {}),
        asaasAccountIdMasked: maskToken(asaasAccountId),
        financeProfileAsaasAccountIdMasked: maskToken(profile.asaasAccountId ?? null),
      },
    };
  }

  const asaasAccountId = resolved.asaasAccountId;
  const asaasAccountIdMasked = maskToken(asaasAccountId);

  const asaasAccountAfterRepair = resolved.repaired
    ? await prisma.asaasAccount.findUnique({
      where: { financeProfileId: profile.id },
      select: {
        id: true,
        asaasAccountId: true,
        deletedAsaasAccountId: true,
        externalReference: true,
        status: true,
        deletionState: true,
        deletedExternallyAt: true,
        deletedLocallyAt: true,
        deletionAttempts: true,
      },
    })
    : asaasAccount;

  if (!asaasAccountAfterRepair?.id) {
    pushStep(steps, 'load', 'error', 'AsaasAccount não vinculado (após reparo).');
    return {
      success: false,
      status: 'deletion_failed_needs_admin',
      summary: 'A subconta do Asaas não está vinculada localmente.',
      errorCode: 'ASAAS_ACCOUNT_NOT_LINKED',
      asaasDeleted: false,
      localDeleted: false,
      steps,
      debugSafe: {
        financeProfileId: profile.id,
        asaasAccountIdMasked,
        financeProfileAsaasAccountIdMasked: maskToken(profile.asaasAccountId ?? null),
      },
    };
  }

  const asaasAccountResolved = asaasAccountAfterRepair;
  asaasAccount = asaasAccountResolved;

  if (resolved.repaired) {
    pushStep(steps, 'load', 'ok', 'Vínculo local reparado via FinanceProfile.asaasAccountId.', {
      financeProfileId: profile.id,
      asaasAccountIdMasked,
    });
  }

  pushStep(steps, 'load', 'ok', 'Vínculo local carregado.', {
    financeProfileId: profile.id,
    asaasAccountIdMasked,
  });

  // Idempotência / consistência (baseado em estado local persistido)
  const localDeleted = Boolean(conta.deletedAt);
  const externalDeleted =
    asaasAccountResolved.deletionState === 'DELETED' ||
    asaasAccountResolved.deletionState === 'DELETED_EXTERNALLY' ||
    Boolean(asaasAccountResolved.deletedExternallyAt);

  if (localDeleted && externalDeleted) {
    pushStep(steps, 'load', 'ok', 'Conta já está deletada localmente e externamente (idempotente).');
    return {
      success: true,
      status: 'deleted',
      summary: 'Conta já estava excluída (Asaas + Alusa).',
      asaasDeleted: true,
      localDeleted: true,
      steps,
      debugSafe: {
        financeProfileId: profile.id,
        asaasAccountIdMasked: maskToken(asaasAccountId),
      },
    };
  }

  if (asaasAccountResolved.deletionState === 'DELETING') {
    pushStep(steps, 'load', 'skipped', 'Exclusão já está em progresso (lock).');
    return {
      success: false,
      status: 'deleting',
      summary: 'Exclusão já está em andamento. Tente novamente em instantes.',
      errorCode: 'DELETE_ALREADY_IN_PROGRESS',
      asaasDeleted: externalDeleted,
      localDeleted,
      steps,
      debugSafe: {
        financeProfileId: profile.id,
        asaasAccountIdMasked: maskToken(asaasAccountId),
      },
    };
  }

  // Lock otimista p/ evitar corrida
  const nowLock = new Date();
  const lock = await prisma.asaasAccount.updateMany({
    where: {
      id: asaasAccountResolved.id,
      deletionState: { notIn: ['DELETING', 'DELETED'] },
    },
    data: {
      deletionState: 'DELETING',
      deletionRequestedAt: asaasAccountResolved.deletionState === 'NOT_REQUESTED' ? nowLock : undefined,
      deletionLastAttemptAt: nowLock,
      deletionAttempts: { increment: 1 },
      deletionLastHttpStatus: null,
      deletionLastErrors: Prisma.DbNull,
    },
  });

  if (lock.count === 0) {
    const current = await prisma.asaasAccount.findUnique({
      where: { id: asaasAccountResolved.id },
      select: { deletionState: true, deletedExternallyAt: true },
    });

    if (current?.deletionState === 'DELETING') {
      pushStep(steps, 'load', 'skipped', 'Exclusão já está em progresso (lock).');
      return {
        success: false,
        status: 'deleting',
        summary: 'Exclusão já está em andamento. Tente novamente em instantes.',
        errorCode: 'DELETE_ALREADY_IN_PROGRESS',
        asaasDeleted: Boolean(current.deletedExternallyAt),
        localDeleted,
        steps,
        debugSafe: {
          financeProfileId: profile.id,
          asaasAccountIdMasked: maskToken(asaasAccountId),
        },
      };
    }
  }

  // 2) Obter API key da SUBCONTA
  let subaccountApiKey: string | null = null;
  let createdAccessTokenId: string | null = null;

  pushStep(steps, 'subaccount_apikey', 'in_progress', 'Obtendo API key da subconta…');

  const existingCreds = await loadAsaasCredentials(profile.contaId);
  if (existingCreds?.apiKey) {
    try {
      const myStatus = await getMyAccountStatus({ apiKey: existingCreds.apiKey });
      if (myStatus.id && myStatus.id === asaasAccountId) {
        subaccountApiKey = existingCreds.apiKey;
        pushStep(steps, 'subaccount_apikey', 'ok', 'API key da subconta encontrada e validada localmente.');
      } else {
        pushStep(
          steps,
          'subaccount_apikey',
          'skipped',
          'API key local não corresponde à subconta (ignorada por segurança).',
          { myAccountIdMasked: maskToken(myStatus.id ?? null) },
        );
      }
    } catch (error) {
      const status = error instanceof AsaasHttpError ? error.status : null;
      const errors = error instanceof AsaasHttpError ? extractAsaasErrors(error.response) : [];

      pushStep(
        steps,
        'subaccount_apikey',
        'skipped',
        'Não foi possível validar a API key local (ignorando por segurança).',
        { status, errors },
      );
    }
  }

  // Se não foi possível validar/usar a API key local, fazer fallback seguro criando um token temporário via conta-pai.
  if (!subaccountApiKey) {
    try {
      const created = await createSubaccountAccessToken({
        apiKey: getMasterAsaasApiKey(),
        accountId: asaasAccountId,
        name: `Alusa - delete account (${new Date().toISOString()})`,
      });

      subaccountApiKey = created.apiKey;
      createdAccessTokenId = created.id;

      pushStep(steps, 'subaccount_apikey', 'ok', 'API key temporária criada via conta-pai.', {
        accessTokenIdMasked: maskToken(createdAccessTokenId),
      });
    } catch (error) {
      const status = error instanceof AsaasHttpError ? error.status : null;
      const errors = error instanceof AsaasHttpError ? extractAsaasErrors(error.response) : [];
      const failure = classifyAsaasOperationalError(error, 'master');
      const blocked = failure.category === 'invalid_master_credentials';

      const nextActionHint =
        'Cadastre a API key da subconta em Configurações → Integrações → Asaas (token da API). ' +
        'Alternativamente, habilite no Asaas (White Label) o gerenciamento de API keys de subcontas e whitelist de IP, se aplicável.';

      const firstDescriptions = errors
        .map((e) => e.description)
        .filter((d): d is string => Boolean(d))
        .slice(0, 2);

      const statusLabel = status ? `HTTP ${status}` : 'HTTP ?';
      const asaasMsg = firstDescriptions.length ? ` Asaas: ${firstDescriptions.join(' | ')}` : '';

      // Log server-side (seguro): sem tokens
      console.warn('[admin.delete-account][subaccount_apikey] falha ao criar access token', {
        status,
        errorsCount: errors.length,
        firstDescriptions,
        asaasAccountIdMasked: maskToken(asaasAccountId),
        financeProfileId: profile.id,
      });

      pushStep(
        steps,
        'subaccount_apikey',
        'error',
        blocked
          ? `Gerenciamento de chaves de subconta bloqueado no Asaas (${statusLabel}).${asaasMsg}`
          : `Falha ao criar API key temporária da subconta (${statusLabel}).${asaasMsg}`,
        {
          status,
          category: failure.category,
          errors,
        },
      );

      // Não deixar lock preso em DELETING
      await prisma.asaasAccount.update({
        where: { id: asaasAccount.id },
        data: {
          deletionState: 'DELETION_FAILED',
          deletionLastHttpStatus: status,
          deletionLastErrors: errors as unknown as object,
          deletionLastAttemptAt: new Date(),
        },
        select: { id: true },
      });

      return {
        success: false,
        status: 'deletion_failed_needs_admin',
        summary: blocked
          ? `Não foi possível obter a API key da subconta via Asaas (recurso bloqueado). ${nextActionHint}`
          : `Não foi possível obter a API key da subconta. ${nextActionHint}`,
        errorCode: blocked
          ? 'ASAAS_SUBACCOUNT_APIKEY_MANAGEMENT_DISABLED'
          : 'ASAAS_SUBACCOUNT_APIKEY_CREATE_FAILED',
        asaasDeleted: false,
        localDeleted: false,
        steps,
        debugSafe: { financeProfileId: profile.id, asaasAccountIdMasked: maskToken(asaasAccountId) },
      };
    }
  }

  if (!subaccountApiKey) {
    pushStep(steps, 'subaccount_apikey', 'error', 'API key da subconta indisponível.');

    // Não deixar lock preso em DELETING
    await prisma.asaasAccount.update({
      where: { id: asaasAccount.id },
      data: {
        deletionState: 'DELETION_FAILED',
        deletionLastAttemptAt: new Date(),
      },
      select: { id: true },
    });

    return {
      success: false,
      status: 'deletion_failed_needs_admin',
      summary: 'Não foi possível obter a API key da subconta.',
      errorCode: 'ASAAS_SUBACCOUNT_APIKEY_CREATE_FAILED',
      asaasDeleted: false,
      localDeleted: false,
      steps,
      debugSafe: { financeProfileId: profile.id, asaasAccountIdMasked: maskToken(asaasAccountId) },
    };
  }

  // 3) Pré-checagens read-only (best-effort)
  pushStep(steps, 'precheck', 'in_progress', 'Executando pré-checagens (somente leitura)…');
  try {
    const balance = await getBalance({ apiKey: subaccountApiKey });
    pushStep(steps, 'precheck', 'ok', 'Pré-checagens concluídas.', {
      balance: balance.balance,
    });
  } catch {
    pushStep(steps, 'precheck', 'skipped', 'Não foi possível obter saldo para pré-checagens.');
  }

  // 4) Excluir no Asaas
  pushStep(steps, 'delete_asaas', 'in_progress', 'Excluindo no Asaas…');

  const removeReason = input.removeReason.trim();
  const deleteAttempt = await withAsaasRetry(
    async () => deleteMyAccount({ apiKey: subaccountApiKey, removeReason }),
    { maxAttempts: 4 },
  );

  if (deleteAttempt.error) {
    const error = deleteAttempt.error;
    const status = error instanceof AsaasHttpError ? error.status : null;
    const errors = error instanceof AsaasHttpError ? extractAsaasErrors(error.response) : [];
    const message = error instanceof Error ? error.message : String(error);
    const failure = classifyAsaasOperationalError(error, 'subaccount');

    // 404: tratar com segurança antes de persistir falha
    if (status === 404) {
      const current = await prisma.asaasAccount.findUnique({
        where: { id: asaasAccount.id },
        select: { deletedExternallyAt: true, deletionState: true },
      });

      const canAssumeIdempotent =
        current?.deletionState === 'DELETED' ||
        current?.deletionState === 'DELETED_EXTERNALLY' ||
        Boolean(current?.deletedExternallyAt);

      if (!canAssumeIdempotent) {
        await prisma.asaasAccount.update({
          where: { id: asaasAccount.id },
          data: {
            deletionState: 'DELETION_FAILED',
            deletionLastHttpStatus: status,
            deletionLastErrors: errors as unknown as object,
            deletionLastAttemptAt: new Date(),
          },
          select: { id: true },
        });

        await persistIntegrationLog({
          contaId: profile.contaId,
          financeProfileId: profile.id,
          asaasAccountId,
          operation: 'DELETE_SUBACCOUNT',
          status: 'ERROR',
          httpStatus: status,
          request: {
            operation: 'DELETE_SUBACCOUNT',
            removeReason,
            asaasAccountIdMasked: maskToken(asaasAccountId),
            requestId: input.requestId ?? null,
          },
          response: { errors },
          errorMessage: message,
          durationMs: deleteAttempt.elapsedMs,
        });

        console.error(
          '[admin.delete-account][asaas] 404 inconsistente (não assumir sucesso)',
          safeAsaasLogContext({
            financeProfileId: profile.id,
            contaId: profile.contaId,
            asaasAccountId,
            accessTokenId: createdAccessTokenId,
            requestId: input.requestId,
            operation: 'DELETE_SUBACCOUNT',
            httpStatus: status,
            errors,
            attempts: deleteAttempt.attempts,
            elapsedMs: deleteAttempt.elapsedMs,
          }),
        );

        pushStep(steps, 'delete_asaas', 'error', 'Asaas retornou 404 e o estado local não confirma deleção externa.', {
          status,
          errors,
        });

        return {
          success: false,
          status: 'deletion_failed_needs_admin',
          summary:
            'O Asaas retornou 404 (recurso não encontrado), mas o estado local não confirma deleção externa. Necessário checar consistência.',
          errorCode: 'EXTERNAL_NOT_FOUND_INCONSISTENT',
          asaasDeleted: false,
          localDeleted,
          steps,
          debugSafe: { financeProfileId: profile.id, asaasAccountIdMasked: maskToken(asaasAccountId) },
        };
      }

      // Se estado local já confirma deleção externa, tratar 404 como sucesso idempotente e seguir p/ commit local
      await persistIntegrationLog({
        contaId: profile.contaId,
        financeProfileId: profile.id,
        asaasAccountId,
        operation: 'DELETE_SUBACCOUNT',
        status: 'SUCCESS',
        httpStatus: 404,
        request: {
          operation: 'DELETE_SUBACCOUNT',
          removeReason,
          asaasAccountIdMasked: maskToken(asaasAccountId),
          requestId: input.requestId ?? null,
          note: '404 treated as idempotent based on local state',
        },
        response: { errors },
        errorMessage: message,
        durationMs: deleteAttempt.elapsedMs,
      });

      pushStep(
        steps,
        'delete_asaas',
        'ok',
        'Asaas retornou 404, mas deleção externa já estava confirmada (idempotente).',
      );
    } else {
      // Persistir falha (sem segredos) + telemetry/log estruturado
      await prisma.asaasAccount.update({
        where: { id: asaasAccount.id },
        data: {
          deletionState: shouldRetryAsaasStatus(status) ? 'PENDING_EXTERNAL_DELETE' : 'DELETION_FAILED',
          deletionLastHttpStatus: status,
          deletionLastErrors: errors as unknown as object,
          deletionLastAttemptAt: new Date(),
        },
        select: { id: true },
      });

      await persistIntegrationLog({
        contaId: profile.contaId,
        financeProfileId: profile.id,
        asaasAccountId,
        operation: 'DELETE_SUBACCOUNT',
        status: 'ERROR',
        httpStatus: status,
        request: {
          operation: 'DELETE_SUBACCOUNT',
          removeReason,
          asaasAccountIdMasked: maskToken(asaasAccountId),
          requestId: input.requestId ?? null,
        },
        response: {
          errors,
        },
        errorMessage: message,
        durationMs: deleteAttempt.elapsedMs,
      });

      console.error(
        '[admin.delete-account][asaas] falha ao excluir subconta',
        safeAsaasLogContext({
          financeProfileId: profile.id,
          contaId: profile.contaId,
          asaasAccountId,
          accessTokenId: createdAccessTokenId,
          requestId: input.requestId,
          operation: 'DELETE_SUBACCOUNT',
          httpStatus: status,
          errors,
          attempts: deleteAttempt.attempts,
          elapsedMs: deleteAttempt.elapsedMs,
        }),
      );
    }

    // Best-effort cleanup de token temporário (se criamos um)
    if (createdAccessTokenId) {
      try {
        const revokeAttempt = await withAsaasRetry(
          async () =>
            deleteSubaccountAccessToken({
              apiKey: getMasterAsaasApiKey(),
              accountId: asaasAccountId,
              accessTokenId: createdAccessTokenId,
            }),
          { maxAttempts: 3 },
        );

        if (revokeAttempt.error) {
          const revokeErr = revokeAttempt.error;
          const revokeStatus = revokeErr instanceof AsaasHttpError ? revokeErr.status : null;
          const revokeErrors = revokeErr instanceof AsaasHttpError ? extractAsaasErrors(revokeErr.response) : [];

          await persistIntegrationLog({
            contaId: profile.contaId,
            financeProfileId: profile.id,
            asaasAccountId,
            operation: 'REVOKE_KEY',
            status: 'ERROR',
            httpStatus: revokeStatus,
            request: {
              operation: 'REVOKE_KEY',
              asaasAccountIdMasked: maskToken(asaasAccountId),
              accessTokenIdMasked: maskToken(createdAccessTokenId),
              requestId: input.requestId ?? null,
            },
            response: { errors: revokeErrors },
            errorMessage: revokeErr instanceof Error ? revokeErr.message : String(revokeErr),
            durationMs: revokeAttempt.elapsedMs,
          });
        } else {
          await persistIntegrationLog({
            contaId: profile.contaId,
            financeProfileId: profile.id,
            asaasAccountId,
            operation: 'REVOKE_KEY',
            status: 'SUCCESS',
            httpStatus: 200,
            request: {
              operation: 'REVOKE_KEY',
              asaasAccountIdMasked: maskToken(asaasAccountId),
              accessTokenIdMasked: maskToken(createdAccessTokenId),
              requestId: input.requestId ?? null,
            },
            response: { deleted: true },
            errorMessage: null,
            durationMs: revokeAttempt.elapsedMs,
          });
        }
      } catch {
        // noop
      }
    }

    const combined = [message, ...errors.map((e) => e.description).filter(Boolean)].join(' | ').toLowerCase();

    const notAllowedByApi =
      status === 400 ||
      status === 403 ||
      combined.includes('white label') ||
      combined.includes('whitelabel') ||
      combined.includes('web') ||
      combined.includes('app') ||
      combined.includes('interface');

    const hasPending =
      combined.includes('pend') ||
      combined.includes('saldo') ||
      combined.includes('open') ||
      combined.includes('charge') ||
      combined.includes('cobran');

    // Para erros != 404, retornar erro e impedir commit local
    if (status !== 404) {
      pushStep(steps, 'delete_asaas', 'error', 'Falha ao excluir no Asaas.', {
        status,
        errors,
      });

      return {
        success: false,
        status: failure.retryable ? 'pending_external_delete' : 'deletion_failed_needs_admin',
        summary: notAllowedByApi
          ? 'O Asaas não permite exclusão via API para esta subconta. Exclua pela interface web/app do Asaas.'
          : hasPending
            ? 'O Asaas bloqueou a exclusão por pendências financeiras/operacionais na subconta.'
            : status === 401
              ? 'Chave da subconta ausente/inválida (401).'
              : status === 403
                ? 'Acesso negado no Asaas (403). Verifique permissões e whitelist de IP.'
                : 'Falha ao excluir a subconta no Asaas.',
        errorCode: notAllowedByApi
          ? 'ASAAS_DELETE_NOT_ALLOWED'
          : hasPending
            ? 'ASAAS_DELETE_HAS_PENDING'
            : 'ASAAS_DELETE_FAILED',
        asaasDeleted: false,
        localDeleted,
        steps,
        debugSafe: { financeProfileId: profile.id, asaasAccountIdMasked: maskToken(asaasAccountId) },
      };
    }
  } else {
    pushStep(steps, 'delete_asaas', 'ok', 'Exclusão no Asaas concluída.');

    pushStep(steps, 'confirm_asaas', 'in_progress', 'Confirmando exclusão no Asaas…');
    const confirm = await confirmMyAccountDisabled({ apiKey: subaccountApiKey, maxAttempts: 4 });

    if (!confirm.ok) {
      pushStep(
        steps,
        'confirm_asaas',
        'error',
        'O Asaas retornou sucesso, mas a subconta ainda parece ativa (confirmação falhou).',
        { httpStatus: confirm.lastHttpStatus },
      );

      await prisma.asaasAccount.update({
        where: { id: asaasAccount.id },
        data: {
          deletionState: 'PENDING_EXTERNAL_DELETE',
          deletionLastHttpStatus: confirm.lastHttpStatus ?? 200,
          deletionLastErrors: { note: 'postcheck_myAccount_status_failed' } as unknown as object,
          deletionLastAttemptAt: new Date(),
        },
        select: { id: true },
      });

      await persistIntegrationLog({
        contaId: profile.contaId,
        financeProfileId: profile.id,
        asaasAccountId,
        operation: 'DELETE_SUBACCOUNT',
        status: 'ERROR',
        httpStatus: 200,
        request: {
          operation: 'DELETE_SUBACCOUNT',
          removeReason,
          asaasAccountIdMasked: maskToken(asaasAccountId),
          requestId: input.requestId ?? null,
          note: 'Asaas returned 200 but postcheck indicates still active',
        },
        response: { postcheck: { ok: false, lastHttpStatus: confirm.lastHttpStatus } },
        errorMessage: 'Asaas deletion returned success but could not be confirmed via /myAccount/status',
        durationMs: deleteAttempt.elapsedMs,
      });

      return {
        success: false,
        status: 'pending_external_delete',
        summary:
          'O Asaas retornou sucesso, mas não foi possível confirmar a desativação da subconta. Aguarde e tente novamente.',
        errorCode: 'ASAAS_DELETE_FAILED',
        asaasDeleted: false,
        localDeleted: false,
        steps,
        debugSafe: {
          financeProfileId: profile.id,
          asaasAccountIdMasked: maskToken(asaasAccountId),
          postcheck: { lastHttpStatus: confirm.lastHttpStatus },
        },
      };
    }

    pushStep(steps, 'confirm_asaas', 'ok', 'Exclusão confirmada no Asaas.');

    await prisma.asaasAccount.update({
      where: { id: asaasAccount.id },
      data: {
        deletionState: 'DELETED_EXTERNALLY',
        deletedExternallyAt: new Date(),
      },
      select: { id: true },
    });

    await persistIntegrationLog({
      contaId: profile.contaId,
      financeProfileId: profile.id,
      asaasAccountId,
      operation: 'DELETE_SUBACCOUNT',
      status: 'SUCCESS',
      httpStatus: 200,
      request: {
        operation: 'DELETE_SUBACCOUNT',
        removeReason,
        asaasAccountIdMasked: maskToken(asaasAccountId),
        requestId: input.requestId ?? null,
      },
      response: { deleted: true },
      errorMessage: null,
      durationMs: deleteAttempt.elapsedMs,
    });

    // Se criamos uma API key temporária, revogar (best-effort; não bloquear commit local)
    if (createdAccessTokenId) {
      const revokeAttempt = await withAsaasRetry(
        async () =>
          deleteSubaccountAccessToken({
            apiKey: getMasterAsaasApiKey(),
            accountId: asaasAccountId,
            accessTokenId: createdAccessTokenId,
          }),
        { maxAttempts: 3 },
      );

      if (revokeAttempt.error) {
        const revokeErr = revokeAttempt.error;
        const revokeStatus = revokeErr instanceof AsaasHttpError ? revokeErr.status : null;
        const revokeErrors = revokeErr instanceof AsaasHttpError ? extractAsaasErrors(revokeErr.response) : [];

        await persistIntegrationLog({
          contaId: profile.contaId,
          financeProfileId: profile.id,
          asaasAccountId,
          operation: 'REVOKE_KEY',
          status: 'ERROR',
          httpStatus: revokeStatus,
          request: {
            operation: 'REVOKE_KEY',
            asaasAccountIdMasked: maskToken(asaasAccountId),
            accessTokenIdMasked: maskToken(createdAccessTokenId),
            requestId: input.requestId ?? null,
          },
          response: { errors: revokeErrors },
          errorMessage: revokeErr instanceof Error ? revokeErr.message : String(revokeErr),
          durationMs: revokeAttempt.elapsedMs,
        });
      } else {
        await persistIntegrationLog({
          contaId: profile.contaId,
          financeProfileId: profile.id,
          asaasAccountId,
          operation: 'REVOKE_KEY',
          status: 'SUCCESS',
          httpStatus: 200,
          request: {
            operation: 'REVOKE_KEY',
            asaasAccountIdMasked: maskToken(asaasAccountId),
            accessTokenIdMasked: maskToken(createdAccessTokenId),
            requestId: input.requestId ?? null,
          },
          response: { deleted: true },
          errorMessage: null,
          durationMs: revokeAttempt.elapsedMs,
        });
      }
    }
  }

  // 5) Somente após sucesso no Asaas: soft delete local
  pushStep(steps, 'delete_local', 'in_progress', 'Desativando conta na Alusa (soft delete)…');

  try {
    // Soft delete: mantém dados, mas marca como deletado/inativo
    await prisma.conta.update({
      where: { id: profile.contaId },
      data: {
        status: 'INATIVO',
        deletedAt: new Date(),
        deletedByUserId: input.actor.id,
        deleteReason: input.removeReason,
      },
    });

    // Desconecta vínculo Asaas para evitar uso acidental, mas mantém histórico em deletedAsaasAccountId
    // Se a exclusão externa já foi confirmada, marcamos a deleção como concluída (DELETED) após o soft delete local.
    await prisma.asaasAccount.update({
      where: { id: asaasAccount.id },
      data: {
        deletionState: 'DELETED',
        deletedLocallyAt: new Date(),
        asaasAccountId: null,
        externalReference: null,
        deletedAsaasAccountId: asaasAccountId, // Preserva ID para histórico
      },
    });

    pushStep(steps, 'delete_local', 'ok', 'Conta desativada localmente.');
  } catch (error) {
    pushStep(steps, 'delete_local', 'error', 'Falha ao desativar localmente.', {
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      status: 'deletion_failed_needs_admin',
      summary: 'A subconta foi excluída no Asaas, mas falhamos ao desativar na Alusa. Verifique logs.',
      errorCode: 'LOCAL_DELETE_FAILED',
      asaasDeleted: true,
      localDeleted: false,
      steps,
      debugSafe: { financeProfileId: profile.id, asaasAccountIdMasked: maskToken(asaasAccountId) },
    };
  }

  // 6) Auditoria
  pushStep(steps, 'audit', 'in_progress', 'Registrando auditoria…');

  await auditLogService.record({
    contaId: profile.contaId,
    action: 'finance.admin.asaas_account_deleted',
    entity: { type: 'FinanceProfile', id: profile.id },
    metadata: {
      asaasAccountId,
      removeReason: input.removeReason,
      asaasDeleted: true,
      localDeleted: true,
      usedTemporaryAccessToken: !!createdAccessTokenId,
    },
    actor: input.actor,
  });

  pushStep(steps, 'audit', 'ok', 'Auditoria registrada.');

  return {
    success: true,
    status: 'deleted',
    summary: 'Conta excluída com sucesso (Asaas + Alusa).',
    asaasDeleted: true,
    localDeleted: true,
    steps,
    debugSafe: { financeProfileId: profile.id, asaasAccountIdMasked: maskToken(asaasAccountId) },
  };
}
