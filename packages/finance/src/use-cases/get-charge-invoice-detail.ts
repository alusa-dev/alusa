import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';

import { buildChargeInvoiceTexts, resolveChargeInvoiceContext } from '../fiscal/charge-invoice-context';
import { resolveChargeInvoiceEmissionPath } from '../fiscal/charge-invoice-emission-path';
import {
  evaluateChargeInvoiceEligibility,
  type ChargeInvoiceEligibility,
} from '../fiscal/charge-invoice-eligibility';
import { evaluateChargePayerFiscalReadiness, mapPayerFiscalReadinessForApi } from '../fiscal/payer-fiscal-readiness';
import { ensureAcademicChargeForCobranca } from '../fiscal/ensure-academic-charge-for-cobranca';
import { getFiscalPrisma } from '../fiscal/fiscal-prisma';
import { todayInBrazil } from '../fiscal/invoice-effective-date';
import { resolveChargeFromRouteRef } from '../fiscal/resolve-charge-route-ref';
import { isInvoiceProviderSyncPending } from '../mappers/invoice-status.mapper';
import { ensureChargeInvoiceAutoEmission } from './ensure-charge-invoice-auto-emission';
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
  autoEmission: {
    enabled: boolean;
    path: 'ALUSA' | 'ASAAS_SUBSCRIPTION' | 'MANUAL';
    state:
      | 'PENDING_PAYMENT'
      | 'SCHEDULED'
      | 'PROCESSING'
      | 'EMITTED'
      | 'FAILED'
      | 'MANUAL_REQUIRED';
    message: string;
  };
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
  payerReadiness?: {
    ready: boolean;
    issues: Array<{ code: string; message: string; blocking: boolean }>;
    responsavelId?: string;
    responsavelNome?: string;
  };
};

export type GetChargeInvoiceDetailError = 'CHARGE_NAO_ENCONTRADO' | 'ERRO_INTERNO';

type FiscalSettingsLoadResult = Awaited<ReturnType<typeof getFiscalInvoiceSettings>>;

function mapReadinessFromSettings(result: FiscalSettingsLoadResult) {
  if (result.success) {
    return result.data.readiness;
  }
  return {
    ready: false,
    issues: [{ code: 'ERRO', message: 'Não foi possível verificar prontidão.', blocking: true }],
  };
}

function mapSupportsCancellation(result: FiscalSettingsLoadResult): boolean | null {
  if (!result.success) return null;
  const municipalOptions = result.data.municipalOptions as { supportsCancellation?: unknown } | null;
  return typeof municipalOptions?.supportsCancellation === 'boolean'
    ? municipalOptions.supportsCancellation
    : null;
}

function buildDetailWithoutCharge(input: {
  fiscalSettingsResult: FiscalSettingsLoadResult;
  cobranca: {
    status: string;
    valor: unknown;
    valorFinal: unknown;
  };
}): ChargeInvoiceDetailOutput {
  const readiness = mapReadinessFromSettings(input.fiscalSettingsResult);

  return {
    invoice: null,
    readiness: {
      ready: readiness.ready,
      issues: readiness.issues,
    },
    municipalOptions: {
      supportsCancellation: mapSupportsCancellation(input.fiscalSettingsResult),
    },
    eligibility: evaluateChargeInvoiceEligibility({
      charge: null,
      cobranca: {
        status: input.cobranca.status,
        valor: Number(input.cobranca.valor),
        valorFinal: input.cobranca.valorFinal == null ? null : Number(input.cobranca.valorFinal),
      },
      invoice: null,
    }),
    syncPending: false,
    autoEmission: {
      enabled: false,
      path: 'MANUAL',
      state: 'MANUAL_REQUIRED',
      message: 'A emissão manual ficará disponível quando a cobrança estiver sincronizada.',
    },
    preview: undefined,
  };
}

async function resolveAutoEmissionPath(input: {
  contaId: string;
  chargeId: string;
}): Promise<'ALUSA' | 'ASAAS_SUBSCRIPTION'> {
  const prisma = getFiscalPrisma();
  const charge = await prisma.charge.findFirst({
    where: { id: input.chargeId, contaId: input.contaId },
    select: {
      standaloneSubscriptionId: true,
      standaloneSubscription: {
        select: {
          asaasSubscriptionId: true,
          asaasInvoiceSettingsConfigured: true,
        },
      },
      cobranca: {
        select: {
          tipo: true,
          matriculaId: true,
        },
      },
    },
  });

  if (!charge) return 'ALUSA';

  const subscription = charge.cobranca?.matriculaId
    ? await prisma.subscription.findFirst({
        where: { contaId: input.contaId, matriculaId: charge.cobranca.matriculaId },
        select: {
          asaasSubscriptionId: true,
          asaasInvoiceSettingsConfigured: true,
        },
      })
    : null;

  const path = resolveChargeInvoiceEmissionPath({ charge, subscription });
  return path === 'ASAAS_SUBSCRIPTION_NATIVE' ? 'ASAAS_SUBSCRIPTION' : 'ALUSA';
}

function buildAutoEmission(input: {
  enabled: boolean;
  path: 'ALUSA' | 'ASAAS_SUBSCRIPTION' | 'MANUAL';
  invoice: { status: string } | null;
  readinessReady: boolean;
  eligibility: ChargeInvoiceEligibility;
  syncPending: boolean;
}): ChargeInvoiceDetailOutput['autoEmission'] {
  if (!input.enabled || input.path === 'MANUAL') {
    return {
      enabled: false,
      path: 'MANUAL',
      state: 'MANUAL_REQUIRED',
      message: 'Emissão manual pela tela da cobrança.',
    };
  }

  if (!input.readinessReady) {
    return {
      enabled: true,
      path: input.path,
      state: 'MANUAL_REQUIRED',
      message: 'Automação aguardando a configuração fiscal ficar pronta.',
    };
  }

  if (input.invoice) {
    if (input.invoice.status === 'ERROR' || input.invoice.status === 'CANCELLATION_DENIED') {
      return {
        enabled: true,
        path: input.path,
        state: 'FAILED',
        message: 'A emissão automática falhou. Revise os dados e tente novamente.',
      };
    }
    if (input.invoice.status === 'AUTHORIZED') {
      return {
        enabled: true,
        path: input.path,
        state: 'EMITTED',
        message: 'Nota fiscal emitida automaticamente.',
      };
    }
    return {
      enabled: true,
      path: input.path,
      state: input.syncPending ? 'PROCESSING' : 'SCHEDULED',
      message:
        input.path === 'ASAAS_SUBSCRIPTION'
          ? 'Nota fiscal em emissão automática conforme a assinatura.'
          : 'Nota fiscal em emissão automática pela Alusa.',
    };
  }

  if (input.eligibility.canEmit) {
    return {
      enabled: true,
      path: input.path,
      state: input.path === 'ALUSA' ? 'PROCESSING' : 'SCHEDULED',
      message:
        input.path === 'ASAAS_SUBSCRIPTION'
          ? 'Nota será emitida automaticamente conforme a assinatura recorrente.'
          : 'Emitindo automaticamente após confirmação do pagamento.',
    };
  }

  if (
    input.eligibility.reason === 'PAYMENT_NOT_CONFIRMED' ||
    input.eligibility.reason === 'PAYMENT_PROCESSING' ||
    input.eligibility.reason === 'CHARGE_NOT_SYNCED' ||
    input.eligibility.reason === 'PAYMENT_STATUS_UNKNOWN'
  ) {
    return {
      enabled: true,
      path: input.path,
      state: 'PENDING_PAYMENT',
      message: 'Nota será emitida automaticamente ao confirmar pagamento.',
    };
  }

  return {
    enabled: true,
    path: input.path,
    state: 'MANUAL_REQUIRED',
    message: input.eligibility.message,
  };
}

export async function getChargeInvoiceDetail(input: {
  contaId: string;
  /** Id da cobrança acadêmica ou id da charge (avulsa/parcela). */
  routeRef: string;
}): Promise<Result<ChargeInvoiceDetailOutput, GetChargeInvoiceDetailError>> {
  try {
    const prisma = getFiscalPrisma();
    let resolved = await resolveChargeFromRouteRef(input.contaId, input.routeRef);
    if (!resolved) {
      const cobranca = await prisma.cobranca.findFirst({
        where: { id: input.routeRef, matricula: { aluno: { contaId: input.contaId } } },
        select: {
          id: true,
          status: true,
          valor: true,
          valorFinal: true,
          asaasPaymentId: true,
          asaasStatus: true,
        },
      });
      if (!cobranca) return err('CHARGE_NAO_ENCONTRADO');

      if (cobranca.asaasPaymentId) {
        const ensured = await ensureAcademicChargeForCobranca({
          contaId: input.contaId,
          cobrancaId: cobranca.id,
          asaasPaymentId: cobranca.asaasPaymentId,
          payment: {
            status: cobranca.asaasStatus,
            value:
              cobranca.valorFinal != null ? Number(cobranca.valorFinal) : Number(cobranca.valor),
          },
        });
        if (ensured) {
          await ensureChargeInvoiceAutoEmission({
            contaId: input.contaId,
            chargeId: ensured.chargeId,
          });
          resolved = await resolveChargeFromRouteRef(input.contaId, input.routeRef);
        }
      }

      if (!resolved) {
        const fiscalSettingsResult = await getFiscalInvoiceSettings({
          contaId: input.contaId,
          remoteSync: 'if_stale',
        });
        return ok(
          buildDetailWithoutCharge({
            fiscalSettingsResult,
            cobranca: {
              status: cobranca.status,
              valor: cobranca.valor,
              valorFinal: cobranca.valorFinal,
            },
          }),
        );
      }
    }

    const resolvedCharge = resolved;
    const [invoice, fiscalSettingsResult, defaultService, chargeContext] = await Promise.all([
      prisma.invoice.findFirst({
        where: { chargeId: resolvedCharge.chargeId, contaId: input.contaId },
      }),
      getFiscalInvoiceSettings({ contaId: input.contaId, remoteSync: 'if_stale' }),
      prisma.fiscalService.findFirst({ where: { contaId: input.contaId, isDefault: true } }),
      resolveChargeInvoiceContext(resolvedCharge.chargeId, input.contaId),
    ]);

    const settings = fiscalSettingsResult.success ? fiscalSettingsResult.data.settings : null;
    const readiness = mapReadinessFromSettings(fiscalSettingsResult);
    const supportsCancellation = mapSupportsCancellation(fiscalSettingsResult);
    const payerReadiness = chargeContext
      ? await evaluateChargePayerFiscalReadiness({
          contaId: input.contaId,
          chargeId: resolvedCharge.chargeId,
        })
      : { ready: true, issues: [] as Array<{ code: string; message: string }> };

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
    const syncPending = isInvoiceProviderSyncPending({
      status: invoice?.status,
      hasProviderInvoice: Boolean(invoice?.asaasInvoiceId),
      effectiveDate,
      minEffectiveDate,
    });
    const autoEmissionPath =
      settings?.emissionMode === 'ON_PAYMENT'
        ? await resolveAutoEmissionPath({
            contaId: input.contaId,
            chargeId: resolvedCharge.chargeId,
          })
        : 'MANUAL';

    let preview: ChargeInvoiceDetailOutput['preview'];
    if (chargeContext && defaultService) {
      const texts = buildChargeInvoiceTexts({
        settings: settings
          ? {
              defaultDescriptionTemplate: settings.defaultDescriptionTemplate,
              defaultObservations: settings.defaultObservations,
              defaultDeductions: null,
            }
          : null,
        fiscalService: defaultService,
        context: chargeContext.context,
        overrides:
          settings?.defaultDeductions != null
            ? { deductions: settings.defaultDeductions }
            : undefined,
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
      syncPending,
      autoEmission: buildAutoEmission({
        enabled: settings?.emissionMode === 'ON_PAYMENT',
        path: autoEmissionPath,
        invoice: invoice ? { status: invoice.status } : null,
        readinessReady: readiness.ready,
        eligibility,
        syncPending,
      }),
      preview,
      payerReadiness: chargeContext
        ? mapPayerFiscalReadinessForApi(payerReadiness)
        : undefined,
    });
  } catch (error) {
    console.error('[finance][getChargeInvoiceDetail]', error);
    return err('ERRO_INTERNO');
  }
}
