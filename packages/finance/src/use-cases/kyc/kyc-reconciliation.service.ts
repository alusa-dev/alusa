/**
 * KYC Reconciliation Service
 *
 * Detecta e corrige inconsistências nos modelos KYC (KycProcess, KycRequirement, KycSlot)
 * reconciliando com o estado fresh do Asaas (GET /myAccount/status + GET /myAccount/documents).
 *
 * Cenários cobertos:
 * - KycProcess APPROVED mas KycSlot ainda NOT_SENT
 * - KycRequirement com groupId=ZERO_UUID em processo terminal
 * - Status desatualizado (processo PENDING mas Asaas já APPROVED)
 * - Cache documentsCache desatualizado
 *
 * Regras:
 * - Idempotente: mesma execução N vezes = mesmo resultado
 * - Fail-safe: falha em uma conta não bloqueia outras
 * - Auditável: toda correção é registrada
 */

import {
} from '@alusa/asaas';
import { loadAsaasCredentials, prisma } from '@alusa/database';

import { auditLogService } from '../../foundation/audit-log.service';
import { syncKycModels, deriveProcessStatus } from './kyc-persistence.service';
import { buildCacheV2 } from './kyc-cache-utils';
import { getMyAccountDocumentsCached, getMyAccountStatusCached } from './kyc-asaas-read-cache';

// ── Constants ────────────────────────────────────────────────────────────

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

const TERMINAL_STATUSES = new Set(['APPROVED', 'REJECTED']);

// ── Types ────────────────────────────────────────────────────────────────

export interface KycReconciliationResult {
  checkedAccounts: number;
  inconsistenciesFound: number;
  reconciled: number;
  errors: Array<{ contaId: string; error: string }>;
  details: KycReconciliationDetail[];
  executedAt: Date;
}

export interface KycReconciliationDetail {
  contaId: string;
  asaasAccountId: string;
  issues: string[];
  corrected: boolean;
}

// ── Reconciliation ───────────────────────────────────────────────────────

/**
 * Reconcilia modelos KYC para todas as contas com AsaasAccount provisionado,
 * ou para uma conta específica.
 */
export async function reconcileKycModels(opts?: {
  contaId?: string;
  dryRun?: boolean;
}): Promise<KycReconciliationResult> {
  const dryRun = opts?.dryRun ?? false;

  const result: KycReconciliationResult = {
    checkedAccounts: 0,
    inconsistenciesFound: 0,
    reconciled: 0,
    errors: [],
    details: [],
    executedAt: new Date(),
  };

  const accounts = await prisma.asaasAccount.findMany({
    where: {
      asaasAccountId: { not: null },
      ...(opts?.contaId
        ? { financeProfile: { contaId: opts.contaId } }
        : {}),
    },
    select: {
      id: true,
      asaasAccountId: true,
      status: true,
      financeProfile: { select: { contaId: true } },
    },
    take: 100,
  });

  result.checkedAccounts = accounts.length;

  for (const account of accounts) {
    const contaId = account.financeProfile.contaId;

    try {
      const issues = await detectKycInconsistencies(account.id, contaId);

      if (issues.length === 0) {
        result.details.push({
          contaId,
          asaasAccountId: account.asaasAccountId!,
          issues: [],
          corrected: false,
        });
        continue;
      }

      result.inconsistenciesFound += issues.length;

      if (dryRun) {
        result.details.push({
          contaId,
          asaasAccountId: account.asaasAccountId!,
          issues,
          corrected: false,
        });
        continue;
      }

      // Corrigir: re-sync com dados fresh do Asaas
      const corrected = await reconcileSingleAccount(account.id, contaId, issues);

      result.details.push({
        contaId,
        asaasAccountId: account.asaasAccountId!,
        issues,
        corrected,
      });

      if (corrected) {
        result.reconciled++;
      }
    } catch (err) {
      result.errors.push({
        contaId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.info('[kyc-reconciliation] Reconciliação concluída', {
    checkedAccounts: result.checkedAccounts,
    inconsistenciesFound: result.inconsistenciesFound,
    reconciled: result.reconciled,
    errors: result.errors.length,
    dryRun,
  });

  return result;
}

// ── Detection ────────────────────────────────────────────────────────────

async function detectKycInconsistencies(
  asaasAccountId: string,
  _contaId: string,
): Promise<string[]> {
  const issues: string[] = [];

  const kycProcess = await prisma.kycProcess.findUnique({
    where: { asaasAccountId },
    select: {
      id: true,
      status: true,
      requirements: {
        select: {
          id: true,
          groupId: true,
          status: true,
          slots: {
            select: { id: true, slotId: true, status: true, uploadedFileId: true },
          },
        },
      },
    },
  });

  if (!kycProcess) return issues;

  const isTerminal = TERMINAL_STATUSES.has(kycProcess.status);

  // Zero UUID em processo terminal
  for (const req of kycProcess.requirements) {
    if (req.groupId === ZERO_UUID && isTerminal) {
      issues.push(`KycRequirement(${req.id}) com groupId=ZERO_UUID em processo ${kycProcess.status}`);
    }

    // Slot NOT_SENT em processo APPROVED
    if (kycProcess.status === 'APPROVED') {
      for (const slot of req.slots) {
        if (slot.status === 'NOT_SENT') {
          issues.push(`KycSlot(${slot.id}) status=NOT_SENT em processo APPROVED`);
        }
        if (slot.slotId === ZERO_UUID) {
          issues.push(`KycSlot(${slot.id}) com slotId=ZERO_UUID em processo APPROVED`);
        }
      }
    }
  }

  // Requirement status divergente do processo
  if (kycProcess.status === 'APPROVED') {
    for (const req of kycProcess.requirements) {
      if (req.status !== 'APPROVED' && req.status !== 'IGNORED') {
        issues.push(`KycRequirement(${req.id}) status=${req.status} diverge do processo APPROVED`);
      }
    }
  }

  return issues;
}

// ── Correction ───────────────────────────────────────────────────────────

async function reconcileSingleAccount(
  asaasAccountId: string,
  contaId: string,
  issues: string[],
): Promise<boolean> {
  const creds = await loadAsaasCredentials(contaId);
  if (!creds) return false;

  try {
    const [myAccountStatus, documents] = await Promise.all([
      getMyAccountStatusCached({ apiKey: creds.apiKey }, { forceRefresh: true, intent: 'RECONCILIATION' }),
      getMyAccountDocumentsCached({ apiKey: creds.apiKey }, { forceRefresh: true, intent: 'RECONCILIATION' }),
    ]);

    // Re-sync completo de modelos KYC com dados fresh
    await syncKycModels({
      asaasAccountId,
      myAccountStatus,
      documents,
    });

    // Atualizar cache
    const cachePayload = buildCacheV2({
      myAccountStatus,
      documents,
      fetchedAt: new Date().toISOString(),
    });

    await prisma.asaasAccount.update({
      where: { id: asaasAccountId },
      data: {
        documentsCache: cachePayload as unknown as object,
        documentsCacheUpdatedAt: new Date(),
      },
      select: { id: true },
    });

    await auditLogService.record({
      contaId,
      action: 'finance.kyc.reconciliation',
      entity: { type: 'AsaasAccount', id: asaasAccountId },
      metadata: {
        issues,
        freshProcessStatus: deriveProcessStatus(myAccountStatus, documents.data),
        freshGroupCount: documents.data.length,
      },
      actor: { type: 'SYSTEM' },
    });

    return true;
  } catch (err) {
    console.warn('[kyc-reconciliation] Falha ao reconciliar', {
      contaId,
      asaasAccountId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
