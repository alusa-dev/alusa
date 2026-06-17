import { loadAsaasCredentials } from '@alusa/database';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';
import {
  createInvoice as asaasCreateInvoice,
  getPayment as asaasGetPayment,
  AsaasHttpError,
} from '@alusa/asaas';
import type { InvoiceStatus } from '@prisma/client';

import { auditLogService } from '../foundation/audit-log.service';
import { featureFlagsService } from '../foundation/feature-flags.service';
import { requireKycApproved } from '../foundation/kyc-guard';
import { buildChargeInvoiceTexts, resolveChargeInvoiceContext } from '../fiscal/charge-invoice-context';
import { evaluateChargeInvoiceEligibility } from '../fiscal/charge-invoice-eligibility';
import { recordInvoiceAuditEvent } from '../fiscal/invoice-audit.service';
import { getFiscalPrisma } from '../fiscal/fiscal-prisma';
import { computeFiscalReadiness } from '../fiscal/fiscal-readiness';
import {
  normalizePisCofinsTaxRates,
  validatePisCofinsTaxRules,
} from '../fiscal/pis-cofins-tax-status';
import {
  isInvoiceEffectiveDateValid,
  resolveInvoiceEffectiveDate,
  todayInBrazil,
} from '../fiscal/invoice-effective-date';
import { mapAsaasInvoiceStatusToInternal } from '../mappers/invoice-status.mapper';
import { ensureWebhookConfigOperational } from '../webhooks/ensure-webhook-config-operational';

export type ScheduleChargeInvoiceInput = {
  contaId: string;
  chargeId: string;
  serviceDescription?: string;
  observations?: string;
  deductions?: number;
  effectiveDate?: string;
  actor: { type: 'USER' | 'SYSTEM' | 'ADMIN'; id?: string };
};

export type ScheduleChargeInvoiceOutput = {
  invoiceId: string;
  chargeId: string;
  externalReference: string;
  asaasInvoiceId: string | null;
  status: InvoiceStatus;
  statusUpdatedAt: string;
  pdfUrl: string | null;
  xmlUrl: string | null;
  number: string | null;
  serviceDescription: string | null;
  createdAt: string;
};

export type ScheduleChargeInvoiceFailure = {
  kind: 'VALIDATION' | 'ASAAS';
  message: string;
};

export type ScheduleChargeInvoiceError =
  | 'FEATURE_DISABLED'
  | 'KYC_NAO_APROVADO'
  | 'FISCAL_NOT_READY'
  | 'CHARGE_NAO_ENCONTRADO'
  | 'CHARGE_SEM_PAGAMENTO_ASAAS'
  | 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
  | 'ERRO_AO_AGENDAR_INVOICE'
  | 'ERRO_INTERNO'
  | ScheduleChargeInvoiceFailure;

function extractAsaasErrorMessage(error: AsaasHttpError): string {
  const responseBody =
    error.responseBody && typeof error.responseBody === 'object'
      ? (error.responseBody as { errors?: Array<{ description?: string }> })
      : null;
  const details =
    responseBody?.errors
      ?.map((item) => item.description)
      .filter((value): value is string => Boolean(value)) ?? [];
  return details.join('; ') || error.message;
}

function buildCanonicalInvoiceExternalReference(invoiceId: string): string {
  return `invoice:${invoiceId}`;
}

export async function scheduleChargeInvoice(
  input: ScheduleChargeInvoiceInput,
): Promise<Result<ScheduleChargeInvoiceOutput, ScheduleChargeInvoiceError>> {
  const prisma = getFiscalPrisma();
  let persistedInvoiceId: string | null = null;

  try {
    const enabled = await featureFlagsService.isEnabled(input.contaId, 'enableInvoices');
    if (!enabled) return err('FEATURE_DISABLED');

    const kyc = await requireKycApproved(input.contaId);
    if (!kyc.success) return err('KYC_NAO_APROVADO');

    const [settings, services] = await Promise.all([
      prisma.contaFiscalSettings.findUnique({ where: { contaId: input.contaId } }),
      prisma.fiscalService.findMany({ where: { contaId: input.contaId } }),
    ]);

    const readiness = computeFiscalReadiness({
      settings,
      services,
      kycApproved: true,
      invoicesEnabled: true,
    });
    if (!readiness.ready) return err('FISCAL_NOT_READY');

    const defaultService = services.find((s) => s.isDefault);
    if (!defaultService) return err('FISCAL_NOT_READY');

    const pisCofinsIssues = validatePisCofinsTaxRules({
      simplesNacional: settings?.simplesNacional ?? true,
      useNationalPortal: Boolean(settings?.useNationalPortal),
      pisCofinsTaxStatus: defaultService.pisCofinsTaxStatus,
      pis: Number(defaultService.pis),
      cofins: Number(defaultService.cofins),
    });
    if (pisCofinsIssues.length > 0) {
      return err({
        kind: 'VALIDATION',
        message: pisCofinsIssues[0]?.message ?? 'Revise PIS/COFINS do serviço fiscal padrão.',
      });
    }

    const chargeContext = await resolveChargeInvoiceContext(input.chargeId, input.contaId);
    if (!chargeContext) return err('CHARGE_NAO_ENCONTRADO');
    if (!chargeContext.charge.asaasPaymentId) return err('CHARGE_SEM_PAGAMENTO_ASAAS');

    const { serviceDescription, observations, deductions } = buildChargeInvoiceTexts({
      settings,
      fiscalService: defaultService,
      context: chargeContext.context,
      overrides: {
        serviceDescription: input.serviceDescription,
        observations: input.observations,
        deductions: input.deductions,
      },
    });

    const value = chargeContext.value;

    const effectiveDate = resolveInvoiceEffectiveDate(
      chargeContext.charge.cobranca?.vencimento ?? chargeContext.charge.dueDate ?? null,
      input.effectiveDate,
    );

    if (!isInvoiceEffectiveDateValid(effectiveDate, todayInBrazil())) {
      return err({
        kind: 'VALIDATION',
        message: 'A data de emissão não pode ser anterior à data atual.',
      });
    }

    if (deductions > value) {
      return err({
        kind: 'VALIDATION',
        message: 'As deduções não podem ser maiores que o valor da nota fiscal.',
      });
    }

    const existing = await prisma.invoice.findUnique({
      where: { chargeId: chargeContext.charge.id },
      select: {
        id: true,
        chargeId: true,
        externalReference: true,
        asaasInvoiceId: true,
        status: true,
        statusUpdatedAt: true,
        pdfUrl: true,
        xmlUrl: true,
        number: true,
        serviceDescription: true,
        createdAt: true,
      },
    });

    if (existing?.asaasInvoiceId && existing.status !== 'ERROR') {
      return ok({
        invoiceId: existing.id,
        chargeId: existing.chargeId,
        externalReference: existing.externalReference,
        asaasInvoiceId: existing.asaasInvoiceId,
        status: existing.status,
        statusUpdatedAt: existing.statusUpdatedAt.toISOString(),
        pdfUrl: existing.pdfUrl ?? null,
        xmlUrl: existing.xmlUrl ?? null,
        number: existing.number ?? null,
        serviceDescription: existing.serviceDescription ?? null,
        createdAt: existing.createdAt.toISOString(),
      });
    }

    const localEligibility = evaluateChargeInvoiceEligibility({
      charge: {
        status: chargeContext.charge.status,
        asaasStatus: chargeContext.charge.asaasStatus,
        asaasPaymentId: chargeContext.charge.asaasPaymentId,
        value,
      },
      cobranca: chargeContext.charge.cobranca
        ? {
            status: chargeContext.charge.cobranca.status,
            valor: Number(chargeContext.charge.cobranca.valor),
            valorFinal:
              chargeContext.charge.cobranca.valorFinal == null
                ? null
                : Number(chargeContext.charge.cobranca.valorFinal),
          }
        : null,
      invoice: existing
        ? {
            status: existing.status,
            hasProviderInvoice: Boolean(existing.asaasInvoiceId),
          }
        : null,
    });

    if (!localEligibility.canEmit) {
      return err({
        kind: 'VALIDATION',
        message: localEligibility.message,
      });
    }

    const invoiceId = chargeContext.charge.id;
    const externalReference = buildCanonicalInvoiceExternalReference(invoiceId);
    const pisCofinsRates = normalizePisCofinsTaxRates({
      pisCofinsTaxStatus: defaultService.pisCofinsTaxStatus,
      pis: Number(defaultService.pis),
      cofins: Number(defaultService.cofins),
    });
    const taxes = {
      retainIss: defaultService.retainIss,
      cofins: pisCofinsRates.cofins,
      csll: Number(defaultService.csll),
      inss: Number(defaultService.inss),
      ir: Number(defaultService.ir),
      pis: pisCofinsRates.pis,
      iss: Number(defaultService.iss),
      nbsCode: defaultService.nbsCode,
      taxSituationCode: defaultService.taxSituationCode,
      taxClassificationCode: defaultService.taxClassificationCode,
      operationIndicatorCode: defaultService.operationIndicatorCode,
      pisCofinsTaxStatus: defaultService.pisCofinsTaxStatus,
      operationPis:
        defaultService.operationPis == null ? null : Number(defaultService.operationPis),
      operationCofins:
        defaultService.operationCofins == null ? null : Number(defaultService.operationCofins),
      useTaxSystemReformNT007: defaultService.useTaxSystemReformNT007,
    };
    const usesProviderMunicipalService = Boolean(defaultService.asaasMunicipalServiceId);
    const municipalServiceId = usesProviderMunicipalService
      ? defaultService.asaasMunicipalServiceId
      : null;
    const municipalServiceCode = usesProviderMunicipalService
      ? null
      : defaultService.municipalServiceCode;

    const invoiceRecord = await prisma.invoice.upsert({
      where: { chargeId: chargeContext.charge.id },
      update: {
        externalReference,
        status: 'SCHEDULED',
        statusUpdatedAt: new Date(),
        serviceDescription,
        observations,
        taxes,
        fiscalServiceId: defaultService.id,
        cobrancaId: chargeContext.cobrancaId,
        matriculaId: chargeContext.matriculaId,
        responsavelId: chargeContext.responsavelId,
        value,
        deductions,
        effectiveDate: new Date(`${effectiveDate}T00:00:00.000Z`),
        scheduledAt: new Date(),
        municipalServiceCode,
        municipalServiceName: defaultService.name,
        errorMessage: null,
      },
      create: {
        id: invoiceId,
        contaId: input.contaId,
        chargeId: chargeContext.charge.id,
        externalReference,
        status: 'SCHEDULED',
        serviceDescription,
        observations,
        taxes,
        fiscalServiceId: defaultService.id,
        cobrancaId: chargeContext.cobrancaId,
        matriculaId: chargeContext.matriculaId,
        responsavelId: chargeContext.responsavelId,
        value,
        deductions,
        effectiveDate: new Date(`${effectiveDate}T00:00:00.000Z`),
        scheduledAt: new Date(),
        municipalServiceCode,
        municipalServiceName: defaultService.name,
      },
      select: { id: true, status: true },
    });
    persistedInvoiceId = invoiceRecord.id;

    const credentials = await loadAsaasCredentials(input.contaId);
    if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

    await ensureWebhookConfigOperational(input.contaId);

    const asaasPayment = await asaasGetPayment({
      apiKey: credentials.apiKey,
      paymentId: chargeContext.charge.asaasPaymentId,
    });
    const providerEligibility = evaluateChargeInvoiceEligibility({
      charge: {
        status: chargeContext.charge.status,
        asaasStatus: asaasPayment.status,
        asaasPaymentId: chargeContext.charge.asaasPaymentId,
        value,
      },
      cobranca: chargeContext.charge.cobranca
        ? {
            status: chargeContext.charge.cobranca.status,
            valor: Number(chargeContext.charge.cobranca.valor),
            valorFinal:
              chargeContext.charge.cobranca.valorFinal == null
                ? null
                : Number(chargeContext.charge.cobranca.valorFinal),
          }
        : null,
      invoice: existing
        ? {
            status: existing.status,
            hasProviderInvoice: Boolean(existing.asaasInvoiceId),
          }
        : null,
      asaasPayment: {
        status: asaasPayment.status,
        deleted: asaasPayment.deleted,
      },
    });

    if (!providerEligibility.canEmit) {
      return err({
        kind: 'VALIDATION',
        message: providerEligibility.message,
      });
    }

    const asaasInvoice = await asaasCreateInvoice({
      apiKey: credentials.apiKey,
      idempotencyKey: `invoice:${chargeContext.charge.id}`,
      data: {
        payment: chargeContext.charge.asaasPaymentId,
        serviceDescription,
        observations,
        externalReference,
        value,
        deductions,
        effectiveDate,
        municipalServiceId,
        municipalServiceCode,
        municipalServiceName: defaultService.name,
        taxes,
      },
    });

    const nextStatus = mapAsaasInvoiceStatusToInternal(asaasInvoice.status);

    const updated = await prisma.invoice.update({
      where: { id: invoiceRecord.id },
      data: {
        asaasInvoiceId: asaasInvoice.id,
        status: nextStatus,
        statusDescription: asaasInvoice.statusDescription ?? null,
        statusUpdatedAt: new Date(),
        pdfUrl: asaasInvoice.pdfUrl ?? null,
        xmlUrl: asaasInvoice.xmlUrl ?? null,
        number: asaasInvoice.number ?? null,
        errorMessage: nextStatus === 'ERROR' ? asaasInvoice.statusDescription ?? 'Erro na emissão' : null,
      },
      select: {
        id: true,
        chargeId: true,
        externalReference: true,
        asaasInvoiceId: true,
        status: true,
        statusUpdatedAt: true,
        pdfUrl: true,
        xmlUrl: true,
        number: true,
        serviceDescription: true,
        createdAt: true,
      },
    });

    await recordInvoiceAuditEvent({
      contaId: input.contaId,
      invoiceId: updated.id,
      action: 'invoice.scheduled',
      fromStatus: invoiceRecord.status,
      toStatus: updated.status,
      metadata: { asaasInvoiceId: updated.asaasInvoiceId },
    });

    await auditLogService.record({
      contaId: input.contaId,
      actor: input.actor,
      action: 'finance.invoice.scheduled',
      entity: { type: 'Invoice', id: updated.id },
      metadata: {
        chargeId: updated.chargeId,
        externalReference: updated.externalReference,
        asaasInvoiceId: updated.asaasInvoiceId,
        status: updated.status,
      },
    });

    return ok({
      invoiceId: updated.id,
      chargeId: updated.chargeId,
      externalReference: updated.externalReference,
      asaasInvoiceId: updated.asaasInvoiceId,
      status: updated.status,
      statusUpdatedAt: updated.statusUpdatedAt.toISOString(),
      pdfUrl: updated.pdfUrl ?? null,
      xmlUrl: updated.xmlUrl ?? null,
      number: updated.number ?? null,
      serviceDescription: updated.serviceDescription ?? null,
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (error) {
    console.error('[finance][scheduleChargeInvoice]', error);

    if (error instanceof AsaasHttpError) {
      const message = extractAsaasErrorMessage(error);
      if (persistedInvoiceId) {
        await prisma.invoice
          .update({
            where: { id: persistedInvoiceId },
            data: {
              status: 'ERROR',
              statusUpdatedAt: new Date(),
              errorMessage: message,
            },
          })
          .catch((updateError) => {
            console.error('[finance][scheduleChargeInvoice] failed to persist invoice error', updateError);
          });
      }
      if (error.status === 400) {
        return err({ kind: 'ASAAS', message });
      }
    }

    return err('ERRO_AO_AGENDAR_INVOICE');
  }
}