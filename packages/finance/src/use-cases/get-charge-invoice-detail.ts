import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';

import { buildChargeInvoiceTexts, resolveChargeInvoiceContext } from '../fiscal/charge-invoice-context';
import {
  evaluateChargeInvoiceEligibility,
  type ChargeInvoiceEligibility,
} from '../fiscal/charge-invoice-eligibility';
import { getFiscalPrisma } from '../fiscal/fiscal-prisma';
import { todayInBrazil } from '../fiscal/invoice-effective-date';
import { resolveChargeFromRouteRef } from '../fiscal/resolve-charge-route-ref';
import { isInvoiceProviderSyncPending } from '../mappers/invoice-status.mapper';
import { getFiscalInvoiceSettings } from './get-fiscal-invoice-settings';

export type ChargeInvoiceDetailOutput = {
  invoice: {
    id: string;
    status: string;
    statusDescription: string | null;
    errorMessage: string | null;
    number: string | null;
    pdfUrl: string | null;
    xmlUrl: string | null;
    serviceDescription: string | null;
    observations: string | null;
    hasProviderInvoice: boolean;
    effectiveDate: string | null;
    scheduledAt: string | null;
    statusUpdatedAt: string;
  } | null;
  readiness: {
    ready: boolean;
    issues: Array<{ code: string; message: string; blocking: boolean }>;
  };
  municipalOptions: {
    supportsCancellation: boolean | null;
  };
  eligibility: ChargeInvoiceEligibility;
  /** A nota ainda pode mudar no Asaas/prefeitura — UI deve manter sincronização assíncrona. */
  syncPending: boolean;
  preview?: {
    serviceDescription: string;
    observations: string;
    deductions: number;
    effectiveDate: string;
    minEffectiveDate: string;
    value: number;
    municipalServiceName: string;
    municipalServiceCode: string | null;
  };
};

export type GetChargeInvoiceDetailError = 'CHARGE_NAO_ENCONTRADO' | 'ERRO_INTERNO';

export async function getChargeInvoiceDetail(input: {
  contaId: string;
  /** Id da cobrança acadêmica ou id da charge (avulsa/parcela). */
  routeRef: string;
}): Promise<Result<ChargeInvoiceDetailOutput, GetChargeInvoiceDetailError>> {
  try {
    const prisma = getFiscalPrisma();
    const resolved = await resolveChargeFromRouteRef(input.contaId, input.routeRef);
    if (!resolved) return err('CHARGE_NAO_ENCONTRADO');

    const [invoice, fiscalSettingsResult, settings, defaultService, chargeContext] = await Promise.all([
      prisma.invoice.findFirst({
        where: { chargeId: resolved.chargeId, contaId: input.contaId },
      }),
      getFiscalInvoiceSettings({ contaId: input.contaId }),
      prisma.contaFiscalSettings.findUnique({ where: { contaId: input.contaId } }),
      prisma.fiscalService.findFirst({ where: { contaId: input.contaId, isDefault: true } }),
      resolveChargeInvoiceContext(resolved.chargeId, input.contaId),
    ]);

    const readiness = fiscalSettingsResult.success
      ? fiscalSettingsResult.data.readiness
      : { ready: false, issues: [{ code: 'ERRO', message: 'Não foi possível verificar prontidão.', blocking: true }] };
    const municipalOptions = fiscalSettingsResult.success
      ? (fiscalSettingsResult.data.municipalOptions as { supportsCancellation?: unknown } | null)
      : null;
    const supportsCancellation =
      typeof municipalOptions?.supportsCancellation === 'boolean'
        ? municipalOptions.supportsCancellation
        : null;

    const eligibility = evaluateChargeInvoiceEligibility({
      charge: chargeContext
        ? {
            status: chargeContext.charge.status,
            asaasStatus: chargeContext.charge.asaasStatus,
            asaasPaymentId: chargeContext.charge.asaasPaymentId,
            value: chargeContext.value,
          }
        : null,
      cobranca: chargeContext?.charge.cobranca
        ? {
            status: chargeContext.charge.cobranca.status,
            valor: Number(chargeContext.charge.cobranca.valor),
            valorFinal:
              chargeContext.charge.cobranca.valorFinal == null
                ? null
                : Number(chargeContext.charge.cobranca.valorFinal),
          }
        : null,
      invoice: invoice
        ? {
            status: invoice.status,
            hasProviderInvoice: Boolean(invoice.asaasInvoiceId),
          }
        : null,
    });

    const minEffectiveDate = todayInBrazil();
    const effectiveDate = invoice?.effectiveDate?.toISOString().slice(0, 10) ?? null;

    let preview: ChargeInvoiceDetailOutput['preview'];
    if (chargeContext && defaultService) {
      const texts = buildChargeInvoiceTexts({
        settings,
        fiscalService: defaultService,
        context: chargeContext.context,
      });
      preview = {
        serviceDescription: texts.serviceDescription,
        observations: texts.observations,
        deductions: texts.deductions,
        effectiveDate: chargeContext.effectiveDate,
        minEffectiveDate,
        value: chargeContext.value,
        municipalServiceName: defaultService.name,
        municipalServiceCode: defaultService.municipalServiceCode ?? null,
      };
    }

    return ok({
      invoice: invoice
        ? {
            id: invoice.id,
            status: invoice.status,
            statusDescription: invoice.statusDescription,
            errorMessage: invoice.errorMessage,
            number: invoice.number,
            pdfUrl: invoice.pdfUrl,
            xmlUrl: invoice.xmlUrl,
            serviceDescription: invoice.serviceDescription,
            observations: invoice.observations,
            hasProviderInvoice: Boolean(invoice.asaasInvoiceId),
            effectiveDate,
            scheduledAt: invoice.scheduledAt?.toISOString() ?? null,
            statusUpdatedAt: invoice.statusUpdatedAt.toISOString(),
          }
        : null,
      readiness: {
        ready: readiness.ready,
        issues: readiness.issues,
      },
      municipalOptions: {
        supportsCancellation,
      },
      eligibility,
      syncPending: isInvoiceProviderSyncPending({
        status: invoice?.status,
        hasProviderInvoice: Boolean(invoice?.asaasInvoiceId),
        effectiveDate,
        minEffectiveDate,
      }),
      preview,
    });
  } catch (error) {
    console.error('[finance][getChargeInvoiceDetail]', error);
    return err('ERRO_INTERNO');
  }
}
