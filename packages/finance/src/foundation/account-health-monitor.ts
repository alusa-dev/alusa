/**
 * Asaas Account Health Monitor
 *
 * Monitora status das subcontas Asaas e gera alertas internos quando:
 * - Documentação rejeitada ou pendente de ação
 * - KYC expirado ou próximo de expirar
 * - Conta com restrições
 * - Webhook interrompido (complemento ao webhook-health.service)
 *
 * Projetado para execução periódica (cron/scheduler).
 */

import { getMyAccountStatus } from '@alusa/asaas';
import { loadAsaasCredentials, prisma } from '@alusa/database';
import { alertService } from '../foundation/alert-channel';
import { validateSubaccountApiKey } from './asaas-api-key';
import {
  ensureWebhookReady,
  FinanceBlockedError,
  syncAsaasOperationalStatus,
} from './asaas-operational-guard';

// ── Types ────────────────────────────────────────────────────────────────

export interface AccountHealthCheckResult {
  checkedAccounts: number;
  apiKeysChecked: number;
  apiKeysInvalid: number;
  apiKeysExpiring: number;
  webhooksChecked: number;
  webhooksNotReady: number;
  operationalAccounts: number;
  alerts: AccountHealthAlert[];
  errors: Array<{ contaId: string; error: string }>;
  executedAt: Date;
}

export interface AccountHealthAlert {
  contaId: string;
  asaasAccountId: string | null;
  type: AccountAlertType;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  details?: Record<string, unknown>;
}

export type AccountAlertType =
  | 'KYC_REJECTED'
  | 'KYC_PENDING'
  | 'KYC_EXPIRING'
  | 'DOCUMENTATION_REJECTED'
  | 'DOCUMENTATION_PENDING'
  | 'ACCOUNT_RESTRICTED'
  | 'COMMERCIAL_INFO_PENDING'
  | 'API_KEY_EXPIRING'
  | 'REGULATORY_EVALUATION_EXPIRING'
  | 'REGULATORY_EVALUATION_BLOCKED'
  | 'REGULATORY_LIMIT_APPROACHING'
  | 'REGULATORY_LIMIT_REACHED';

// Mapeamento de status KYC para severidade
const KYC_SEVERITY_MAP: Record<string, { type: AccountAlertType; severity: AccountHealthAlert['severity'] } | null> = {
  APPROVED: null,
  AWAITING_APPROVAL: { type: 'KYC_PENDING', severity: 'info' },
  PENDING: { type: 'KYC_PENDING', severity: 'warning' },
  REJECTED: { type: 'KYC_REJECTED', severity: 'critical' },
  EXPIRED: { type: 'KYC_EXPIRING', severity: 'critical' },
  EXPIRING_SOON: { type: 'KYC_EXPIRING', severity: 'warning' },
};

const REGULATORY_EVALUATION_MAX_DAYS = 60;
const REGULATORY_EVALUATION_WARNING_DAYS = 15;
const API_KEY_WARNING_DAYS = 30;
const REGULATORY_SUBACCOUNT_WARNING_COUNT = 8;
const REGULATORY_CHARGE_WARNING_AMOUNT = 1_600;

function daysUntil(value: Date | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  return Math.ceil((value.getTime() - now) / 86_400_000);
}

function addCredentialAndRegulatoryAlerts(params: {
  result: AccountHealthCheckResult;
  contaId: string;
  asaasAccountId: string | null;
  apiKeyExpiresAt: Date | null;
  apiKeyProjectedExpirationAt: Date | null;
  regulatoryEvaluationStartedAt: Date | null;
  regulatoryEvaluationGlobalStartedAt: Date | null;
  distinctSubaccountCount: number;
  issuedChargeCount: number;
  issuedChargeAmount: number;
}): void {
  const now = Date.now();
  const apiKeyDays = [
    daysUntil(params.apiKeyExpiresAt, now),
    daysUntil(params.apiKeyProjectedExpirationAt, now),
  ].filter((value): value is number => value !== null).sort((a, b) => a - b)[0] ?? null;

  if (apiKeyDays !== null && apiKeyDays <= API_KEY_WARNING_DAYS) {
    params.result.apiKeysExpiring += 1;
    params.result.alerts.push({
      contaId: params.contaId,
      asaasAccountId: params.asaasAccountId,
      type: 'API_KEY_EXPIRING',
      severity: apiKeyDays <= 0 ? 'critical' : 'warning',
      message: apiKeyDays <= 0
        ? 'A API key da subconta Asaas expirou ou está sem validade projetada.'
        : `A API key da subconta Asaas expira em aproximadamente ${apiKeyDays} dia(s).`,
      details: {
        apiKeyExpiresAt: params.apiKeyExpiresAt?.toISOString() ?? null,
        apiKeyProjectedExpirationAt: params.apiKeyProjectedExpirationAt?.toISOString() ?? null,
        daysUntilExpiration: apiKeyDays,
      },
    });
  }

  const evaluationStartedAt = params.regulatoryEvaluationGlobalStartedAt ?? params.regulatoryEvaluationStartedAt;
  const evaluationDays = daysUntil(
    evaluationStartedAt
      ? new Date(evaluationStartedAt.getTime() + REGULATORY_EVALUATION_MAX_DAYS * 86_400_000)
      : null,
    now,
  );

  if (evaluationDays !== null && evaluationDays <= REGULATORY_EVALUATION_WARNING_DAYS) {
    params.result.alerts.push({
      contaId: params.contaId,
      asaasAccountId: params.asaasAccountId,
      type: evaluationDays <= 0 ? 'REGULATORY_EVALUATION_BLOCKED' : 'REGULATORY_EVALUATION_EXPIRING',
      severity: evaluationDays <= 0 ? 'critical' : 'warning',
      message: evaluationDays <= 0
        ? 'O período de avaliação regulatória do Asaas atingiu o prazo de 60 dias; confirme a liberação com o Asaas.'
        : `O período de avaliação regulatória do Asaas termina em aproximadamente ${evaluationDays} dia(s).`,
      details: {
        regulatoryEvaluationStartedAt: evaluationStartedAt?.toISOString() ?? null,
        evaluationDaysRemaining: evaluationDays,
        documentedLimits: {
          distinctSubaccounts: 10,
          chargesPerSubaccount: 2000,
          durationDays: 60,
        },
      },
    });
  }

  const countReached = params.distinctSubaccountCount >= 10;
  const amountReached = params.issuedChargeAmount >= 2_000;
  const countApproaching = params.distinctSubaccountCount >= REGULATORY_SUBACCOUNT_WARNING_COUNT;
  const amountApproaching = params.issuedChargeAmount >= REGULATORY_CHARGE_WARNING_AMOUNT;

  if (evaluationStartedAt && (countReached || amountReached || countApproaching || amountApproaching)) {
    const reached = countReached || amountReached;
    params.result.alerts.push({
      contaId: params.contaId,
      asaasAccountId: params.asaasAccountId,
      type: reached ? 'REGULATORY_LIMIT_REACHED' : 'REGULATORY_LIMIT_APPROACHING',
      severity: reached ? 'critical' : 'warning',
      message: reached
        ? 'Um limite documentado do período de avaliação regulatória do Asaas foi atingido; novas operações podem ser bloqueadas pelo provedor.'
        : 'A utilização do período de avaliação regulatória do Asaas está próxima dos limites documentados.',
      details: {
        distinctSubaccountCount: params.distinctSubaccountCount,
        issuedChargeCount: params.issuedChargeCount,
        issuedChargeAmount: params.issuedChargeAmount,
        regulatoryEvaluationStartedAt: params.regulatoryEvaluationGlobalStartedAt?.toISOString() ?? null,
        documentedLimits: {
          distinctSubaccounts: 10,
          chargesPerSubaccount: 2000,
          durationDays: 60,
        },
      },
    });
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

export async function checkAccountHealth(opts?: {
  contaId?: string;
}): Promise<AccountHealthCheckResult> {
  const result: AccountHealthCheckResult = {
    checkedAccounts: 0,
    apiKeysChecked: 0,
    apiKeysInvalid: 0,
    apiKeysExpiring: 0,
    webhooksChecked: 0,
    webhooksNotReady: 0,
    operationalAccounts: 0,
    alerts: [],
    errors: [],
    executedAt: new Date(),
  };

  const accounts = await prisma.asaasAccount.findMany({
    where: {
      asaasAccountId: { not: null },
      ...(opts?.contaId
        ? { financeProfile: { contaId: opts.contaId } }
        : { status: { in: ['APPROVED', 'UNDER_REVIEW', 'CREATED'] } }),
    },
    select: {
      id: true,
      asaasAccountId: true,
      status: true,
      apiKeyStatus: true,
      apiKeyExpiresAt: true,
      apiKeyProjectedExpirationAt: true,
      regulatoryEvaluationStartedAt: true,
      financeProfile: { select: { contaId: true } },
    },
  });

  const [distinctSubaccountCount, regulatoryStart] = await Promise.all([
    prisma.asaasAccount.count({ where: { asaasAccountId: { not: null } } }),
    prisma.asaasAccount.aggregate({ _min: { regulatoryEvaluationStartedAt: true } }),
  ]);

  result.checkedAccounts = accounts.length;

  for (const account of accounts) {
    const contaId = account.financeProfile.contaId;

    try {
      const evaluationStartedAt = regulatoryStart._min.regulatoryEvaluationStartedAt ?? account.regulatoryEvaluationStartedAt;
      const issuedCharges = evaluationStartedAt
        ? await prisma.charge.aggregate({
            where: {
              contaId,
              createdAt: { gte: evaluationStartedAt },
              asaasPaymentId: { not: null },
            },
            _count: { _all: true },
            _sum: { value: true },
          })
        : null;

      addCredentialAndRegulatoryAlerts({
        result,
        contaId,
        asaasAccountId: account.asaasAccountId,
        apiKeyExpiresAt: account.apiKeyExpiresAt,
        apiKeyProjectedExpirationAt: account.apiKeyProjectedExpirationAt,
        regulatoryEvaluationStartedAt: account.regulatoryEvaluationStartedAt,
        regulatoryEvaluationGlobalStartedAt: regulatoryStart._min.regulatoryEvaluationStartedAt,
        distinctSubaccountCount,
        issuedChargeCount: issuedCharges?._count._all ?? 0,
        issuedChargeAmount: Number(issuedCharges?._sum.value ?? 0),
      });

      const creds = await loadAsaasCredentials(contaId);
      if (!creds) {
        await prisma.asaasAccount.update({
          where: { id: account.id },
          data: {
            apiKeyStatus: 'MISSING',
            operationalStatus: 'API_KEY_REQUIRED',
            lastHealthCheckAt: new Date(),
            lastApiKeyCheckAt: new Date(),
          },
          select: { id: true },
        });
        await syncAsaasOperationalStatus(contaId);
        continue;
      }

      result.apiKeysChecked++;
      const apiKeyStatus = await validateSubaccountApiKey(creds.apiKey);
      await prisma.asaasAccount.update({
        where: { id: account.id },
        data: {
          apiKeyStatus,
          lastHealthCheckAt: new Date(),
          lastApiKeyCheckAt: new Date(),
        },
        select: { id: true },
      });

      if (apiKeyStatus !== 'CONNECTED') {
        result.apiKeysInvalid++;
        await syncAsaasOperationalStatus(contaId);
        continue;
      }

      result.webhooksChecked++;
      try {
        await ensureWebhookReady(contaId);
      } catch (error) {
        result.webhooksNotReady++;
        if (!(error instanceof FinanceBlockedError)) {
          throw error;
        }
      }

      const status = await getMyAccountStatus({ apiKey: creds.apiKey });

      // Verificar áreas KYC
      const areas = {
        commercialInfo: status.commercialInfo,
        bankAccountInfo: status.bankAccountInfo,
        documentation: status.documentation,
        general: status.general,
      };

      for (const [area, areaStatus] of Object.entries(areas)) {
        if (!areaStatus) continue;
        const mapping = KYC_SEVERITY_MAP[areaStatus];
        if (!mapping) continue;

        const alert: AccountHealthAlert = {
          contaId,
          asaasAccountId: account.asaasAccountId,
          type: area === 'documentation' ? 'DOCUMENTATION_PENDING' : mapping.type,
          severity: mapping.severity,
          message: `Área "${area}": status ${areaStatus}`,
          details: { area, status: areaStatus },
        };

        // Documentação rejeitada é sempre CRITICAL
        if (area === 'documentation' && areaStatus === 'REJECTED') {
          alert.type = 'DOCUMENTATION_REJECTED';
          alert.severity = 'critical';
        }

        if (area === 'commercialInfo' && areaStatus === 'PENDING') {
          alert.type = 'COMMERCIAL_INFO_PENDING';
        }

        result.alerts.push(alert);
      }

      const health = await syncAsaasOperationalStatus(contaId);
      if (health.operationalStatus === 'OPERATIONAL') {
        result.operationalAccounts++;
      }
    } catch (err) {
      result.errors.push({
        contaId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Despachar alertas críticos para canais externos
  const criticalAlerts = result.alerts.filter((a) => a.severity === 'critical');
  for (const alert of criticalAlerts) {
    await alertService.dispatch({
      severity: alert.severity,
      title: `Alerta de conta Asaas: ${alert.type}`,
      message: alert.message,
      contaId: alert.contaId,
      metadata: alert.details,
    }).catch(() => {/* fail-safe */});
  }

  return result;
}
