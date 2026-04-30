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

// ── Types ────────────────────────────────────────────────────────────────

export interface AccountHealthCheckResult {
  checkedAccounts: number;
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
  | 'COMMERCIAL_INFO_PENDING';

// Mapeamento de status KYC para severidade
const KYC_SEVERITY_MAP: Record<string, { type: AccountAlertType; severity: AccountHealthAlert['severity'] } | null> = {
  APPROVED: null,
  AWAITING_APPROVAL: { type: 'KYC_PENDING', severity: 'info' },
  PENDING: { type: 'KYC_PENDING', severity: 'warning' },
  REJECTED: { type: 'KYC_REJECTED', severity: 'critical' },
  EXPIRED: { type: 'KYC_EXPIRING', severity: 'critical' },
  EXPIRING_SOON: { type: 'KYC_EXPIRING', severity: 'warning' },
};

// ── Main ─────────────────────────────────────────────────────────────────

export async function checkAccountHealth(opts?: {
  contaId?: string;
}): Promise<AccountHealthCheckResult> {
  const result: AccountHealthCheckResult = {
    checkedAccounts: 0,
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
      financeProfile: { select: { contaId: true } },
    },
  });

  result.checkedAccounts = accounts.length;

  for (const account of accounts) {
    const contaId = account.financeProfile.contaId;

    try {
      const creds = await loadAsaasCredentials(contaId);
      if (!creds) continue;

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
