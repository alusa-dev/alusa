import { loadAsaasCredentials } from '@alusa/database';
import type { AsaasInvoice } from '@alusa/asaas';
import {
  createInvoice as asaasCreateInvoice,
  getPayment as asaasGetPayment,
  getMunicipalOptions as asaasGetMunicipalOptions,
  listAsaasInvoices,
  AsaasHttpError,
  CircuitOpenError,
} from '@alusa/asaas';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';
import type { InvoiceOperationStatus, InvoiceStatus, Prisma } from '@prisma/client';

import { auditLogService } from '../foundation/audit-log.service';
import { featureFlagsService } from '../foundation/feature-flags.service';
import { requireKycApproved } from '../foundation/kyc-guard';
import { buildChargeInvoiceTexts, resolveChargeInvoiceContext } from '../fiscal/charge-invoice-context';
import { evaluateChargeInvoiceEligibility } from '../fiscal/charge-invoice-eligibility';
import { getFiscalPrisma } from '../fiscal/fiscal-prisma';
import { buildAsaasInvoiceIbsCbs, validateFiscalIbsCbs } from '../fiscal/ibs-cbs';
import {
  buildAsaasInvoiceTaxes,
  validateAsaasInvoiceTaxesInput,
} from '../fiscal/invoice-taxes';
import { recordInvoiceAuditEvent } from '../fiscal/invoice-audit.service';
import {
  buildInvoiceProviderSnapshotUpdate,
  recordUnknownInvoiceStatusIssue,
} from '../fiscal/provider-invoice-snapshot';
import { computeFiscalReadiness } from '../fiscal/fiscal-readiness';
import { evaluateChargePayerFiscalReadiness, syncResponsavelAsaasCustomer } from '../fiscal/payer-fiscal-readiness';
import {
  isInvoiceEffectiveDateValid,
  resolveInvoiceEffectiveDate,
  todayInBrazil,
} from '../fiscal/invoice-effective-date';
import { mapAsaasInvoiceStatusToInternal } from '../mappers/invoice-status.mapper';
import { upsertFinanceReconciliationIssue } from '../reconciliation/finance-reconciliation-issue.service';
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

export type ScheduleChargeInvoiceFailureKind =
  | 'VALIDATION'
  | 'AUTH_CONFIG'
  | 'CONFLICT'
  | 'RATE_LIMIT'
  | 'TRANSIENT'
  | 'AMBIGUOUS'
  | 'INTERNAL'
  | 'ASAAS';

export type ScheduleChargeInvoiceFailure = {
  kind: ScheduleChargeInvoiceFailureKind;
  message: string;
  status?: number;
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

type InvoiceOutputRecord = {
  id: string;
  chargeId: string;
  externalReference: string;
  asaasInvoiceId: string | null;
  status: InvoiceStatus;
  statusUpdatedAt: Date;
  pdfUrl: string | null;
  xmlUrl: string | null;
  number: string | null;
  serviceDescription: string | null;
  createdAt: Date;
};

type ClaimedInvoiceRecord = InvoiceOutputRecord & {
  operationStatus: InvoiceOperationStatus;
  operationLeaseExpiresAt: Date | null;
  operationAttempts: number;
};

const CLAIM_LEASE_MS = 5 * 60 * 1000;
const AMBIGUOUS_SAFE_RETRY_MS = 15 * 60 * 1000;

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

function toOutput(invoice: InvoiceOutputRecord): ScheduleChargeInvoiceOutput {
  return {
    invoiceId: invoice.id,
    chargeId: invoice.chargeId,
    externalReference: invoice.externalReference,
    asaasInvoiceId: invoice.asaasInvoiceId,
    status: invoice.status,
    statusUpdatedAt: invoice.statusUpdatedAt.toISOString(),
    pdfUrl: invoice.pdfUrl ?? null,
    xmlUrl: invoice.xmlUrl ?? null,
    number: invoice.number ?? null,
    serviceDescription: invoice.serviceDescription ?? null,
    createdAt: invoice.createdAt.toISOString(),
  };
}

function selectInvoiceOutput(): Prisma.InvoiceSelect {
  return {
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
    operationStatus: true,
    operationLeaseExpiresAt: true,
    operationAttempts: true,
  };
}

function classifyInvoiceAttemptError(error: unknown): ScheduleChargeInvoiceFailure & {
  retryable: boolean;
  ambiguous: boolean;
} {
  if (error instanceof AsaasHttpError) {
    const message = extractAsaasErrorMessage(error);
    if (error.status === 400 || error.status === 404) {
      return { kind: 'VALIDATION', message, status: error.status, retryable: false, ambiguous: false };
    }
    if (error.status === 401 || error.status === 403) {
      return { kind: 'AUTH_CONFIG', message, status: error.status, retryable: false, ambiguous: false };
    }
    if (error.status === 409) {
      return { kind: 'CONFLICT', message, status: error.status, retryable: true, ambiguous: true };
    }
    if (error.status === 429) {
      return { kind: 'RATE_LIMIT', message, status: error.status, retryable: true, ambiguous: false };
    }
    if (error.status === 408 || error.status >= 500) {
      return { kind: 'AMBIGUOUS', message, status: error.status, retryable: true, ambiguous: true };
    }
    return { kind: 'ASAAS', message, status: error.status, retryable: false, ambiguous: false };
  }

  if (error instanceof CircuitOpenError) {
    return {
      kind: 'TRANSIENT',
      message: error.message,
      retryable: true,
      ambiguous: false,
    };
  }

  if (error instanceof TypeError) {
    return {
      kind: 'AMBIGUOUS',
      message: error.message,
      retryable: true,
      ambiguous: true,
    };
  }

  return {
    kind: 'INTERNAL',
    message: error instanceof Error ? error.message : 'Erro interno ao agendar NFS-e.',
    retryable: true,
    ambiguous: false,
  };
}

function nextAttemptDate(attempts: number, ambiguous: boolean): Date {
  const baseMs = ambiguous ? AMBIGUOUS_SAFE_RETRY_MS : Math.min(60 * 60 * 1000, 2 ** attempts * 60 * 1000);
  return new Date(Date.now() + baseMs);
}

async function markAttemptFailure(input: {
  contaId: string;
  invoiceId: string;
  previousStatus: InvoiceStatus;
  failure: ReturnType<typeof classifyInvoiceAttemptError>;
}) {
  const prisma = getFiscalPrisma();
  const operationStatus: InvoiceOperationStatus = input.failure.ambiguous ? 'RECONCILING' : 'FAILED';
  const status: InvoiceStatus = input.failure.ambiguous ? input.previousStatus : 'ERROR';
  const updated = await prisma.invoice.update({
    where: { id: input.invoiceId },
    data: {
      operationStatus,
      operationLeaseExpiresAt: null,
      nextAttemptAt: input.failure.retryable
        ? nextAttemptDate(1, input.failure.ambiguous)
        : null,
      lastErrorKind: input.failure.kind,
      lastErrorMessage: input.failure.message.slice(0, 1000),
      status,
      statusUpdatedAt: status === input.previousStatus ? undefined : new Date(),
      errorMessage: input.failure.message.slice(0, 1000),
      fiscalDivergence: input.failure.ambiguous,
    },
    select: { id: true, asaasInvoiceId: true, status: true, operationAttempts: true },
  });

  await recordInvoiceAuditEvent({
    contaId: input.contaId,
    invoiceId: input.invoiceId,
    action: input.failure.ambiguous
      ? 'invoice.creation_ambiguous'
      : 'invoice.creation_failed',
    fromStatus: input.previousStatus,
    toStatus: status,
    metadata: {
      errorKind: input.failure.kind,
      message: input.failure.message,
      retryable: input.failure.retryable,
      ambiguous: input.failure.ambiguous,
      operationAttempts: updated.operationAttempts,
    },
  }).catch((error: unknown) => {
    console.warn('[finance][scheduleChargeInvoice][audit-failed]', {
      contaId: input.contaId,
      invoiceId: input.invoiceId,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  if (input.failure.ambiguous || input.failure.retryable) {
    await upsertFinanceReconciliationIssue({
      contaId: input.contaId,
      entityType: 'INVOICE',
      entityId: input.invoiceId,
      asaasId: updated.asaasInvoiceId,
      issueType: input.failure.ambiguous
        ? 'INVOICE_RECOVERY_REQUIRED'
        : 'INVOICE_PROVIDER_LINK_MISSING',
      severity: input.failure.ambiguous ? 'HIGH' : 'MEDIUM',
      localStatus: status,
      remoteStatus: input.failure.kind,
      metadata: {
        errorKind: input.failure.kind,
        message: input.failure.message,
      },
    }).catch((error: unknown) => {
      console.warn('[finance][scheduleChargeInvoice][reconciliation-issue-failed]', {
        contaId: input.contaId,
        invoiceId: input.invoiceId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

async function persistAsaasInvoiceResult(input: {
  contaId: string;
  invoiceId: string;
  previousStatus: InvoiceStatus;
  asaasInvoice: AsaasInvoice;
  action: string;
}): Promise<InvoiceOutputRecord> {
  const prisma = getFiscalPrisma();
  const snapshot = buildInvoiceProviderSnapshotUpdate(input.asaasInvoice);
  const nextStatus = mapAsaasInvoiceStatusToInternal(input.asaasInvoice.status);

  const data: Prisma.InvoiceUpdateInput = nextStatus
    ? {
        ...snapshot,
        asaasInvoiceId: input.asaasInvoice.id,
        status: nextStatus,
        operationStatus: 'IDLE',
        operationLeaseExpiresAt: null,
        nextAttemptAt: null,
        lastErrorKind: null,
        lastErrorMessage: null,
        statusDescription: input.asaasInvoice.statusDescription ?? null,
        statusUpdatedAt: new Date(),
        pdfUrl: input.asaasInvoice.pdfUrl ?? null,
        xmlUrl: input.asaasInvoice.xmlUrl ?? null,
        number: input.asaasInvoice.number ?? null,
        fiscalDivergence: false,
        errorMessage: nextStatus === 'ERROR'
          ? input.asaasInvoice.statusDescription ?? 'Erro na emissão'
          : null,
      }
    : {
        ...snapshot,
        asaasInvoiceId: input.asaasInvoice.id,
        operationStatus: 'IDLE',
        operationLeaseExpiresAt: null,
        nextAttemptAt: null,
        lastErrorKind: 'UNKNOWN_STATUS',
        lastErrorMessage: `Status desconhecido retornado pelo Asaas: ${input.asaasInvoice.status ?? 'UNKNOWN'}`,
        statusDescription: input.asaasInvoice.statusDescription ?? null,
        fiscalDivergence: true,
      };

  const updated = await prisma.invoice.update({
    where: { id: input.invoiceId },
    data,
    select: selectInvoiceOutput(),
  });

  if (!nextStatus) {
    await recordUnknownInvoiceStatusIssue({
      contaId: input.contaId,
      invoiceId: updated.id,
      asaasInvoiceId: input.asaasInvoice.id,
      rawStatus: input.asaasInvoice.status,
      source: input.action === 'invoice.recovered' ? 'reconcile' : 'schedule',
    });
  }

  await recordInvoiceAuditEvent({
    contaId: input.contaId,
    invoiceId: updated.id,
    action: input.action,
    fromStatus: input.previousStatus,
    toStatus: nextStatus ?? input.previousStatus,
    metadata: {
      asaasInvoiceId: updated.asaasInvoiceId,
      rawProviderStatus: input.asaasInvoice.status ?? null,
      unknownProviderStatus: !nextStatus,
    },
  });

  return updated as InvoiceOutputRecord;
}

async function recoverInvoiceByExternalReference(input: {
  contaId: string;
  apiKey: string;
  invoiceId: string;
  previousStatus: InvoiceStatus;
  externalReference: string;
}): Promise<InvoiceOutputRecord | null> {
  const response = await listAsaasInvoices({
    apiKey: input.apiKey,
    externalReference: input.externalReference,
    limit: 10,
  });
  const found =
    response.data?.find((invoice) => invoice.externalReference === input.externalReference) ??
    response.data?.[0] ??
    null;
  if (!found) return null;

  return persistAsaasInvoiceResult({
    contaId: input.contaId,
    invoiceId: input.invoiceId,
    previousStatus: input.previousStatus,
    asaasInvoice: found,
    action: 'invoice.recovered',
  });
}

async function claimInvoiceCreation(input: {
  contaId: string;
  chargeId: string;
  externalReference: string;
  invoiceData: Prisma.InvoiceUncheckedCreateInput;
  invoiceUpdateData: Prisma.InvoiceUncheckedUpdateManyInput;
}): Promise<
  | { kind: 'CLAIMED'; invoice: ClaimedInvoiceRecord }
  | { kind: 'EXISTING'; invoice: ClaimedInvoiceRecord }
  | { kind: 'IN_PROGRESS'; invoice: ClaimedInvoiceRecord }
> {
  const prisma = getFiscalPrisma();
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + CLAIM_LEASE_MS);

  return prisma.$transaction(async (tx) => {
    const existing = (await tx.invoice.findUnique({
      where: { chargeId: input.chargeId },
      select: selectInvoiceOutput(),
    })) as ClaimedInvoiceRecord | null;

    if (existing?.asaasInvoiceId && existing.status !== 'ERROR') {
      return { kind: 'EXISTING', invoice: existing };
    }

    if (existing) {
      const leaseActive =
        existing.operationLeaseExpiresAt != null && existing.operationLeaseExpiresAt > now;
      if (
        (existing.operationStatus === 'CREATING' || existing.operationStatus === 'RECONCILING') &&
        leaseActive
      ) {
        return { kind: 'IN_PROGRESS', invoice: existing };
      }

      const updatedCount = await tx.invoice.updateMany({
        where: {
          id: existing.id,
          contaId: input.contaId,
          OR: [
            { operationStatus: { in: ['IDLE', 'FAILED'] } },
            { operationLeaseExpiresAt: { lte: now } },
            { nextAttemptAt: null },
            { nextAttemptAt: { lte: now } },
            { status: 'ERROR' },
          ],
        },
        data: {
          ...input.invoiceUpdateData,
          operationStatus: 'CREATING',
          operationStartedAt: now,
          operationLeaseExpiresAt: leaseExpiresAt,
          operationAttempts: { increment: 1 },
          nextAttemptAt: null,
          lastErrorKind: null,
          lastErrorMessage: null,
        },
      });

      if (updatedCount.count !== 1) {
        const current = (await tx.invoice.findUnique({
          where: { id: existing.id },
          select: selectInvoiceOutput(),
        })) as ClaimedInvoiceRecord;
        return { kind: 'IN_PROGRESS', invoice: current };
      }

      const claimed = (await tx.invoice.findUnique({
        where: { id: existing.id },
        select: selectInvoiceOutput(),
      })) as ClaimedInvoiceRecord;
      return { kind: 'CLAIMED', invoice: claimed };
    }

    const created = (await tx.invoice
      .create({
        data: {
          ...input.invoiceData,
          operationStatus: 'CREATING',
          operationStartedAt: now,
          operationLeaseExpiresAt: leaseExpiresAt,
          operationAttempts: 1,
        },
        select: selectInvoiceOutput(),
      })
      .catch(async (error: unknown) => {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          (error as { code?: string }).code === 'P2002'
        ) {
          return tx.invoice.findUnique({
            where: { chargeId: input.chargeId },
            select: selectInvoiceOutput(),
          });
        }
        throw error;
      })) as ClaimedInvoiceRecord | null;

    if (!created) {
      throw new Error('Falha ao adquirir claim de emissão fiscal.');
    }

    return created.operationStatus === 'CREATING'
      ? { kind: 'CLAIMED', invoice: created }
      : { kind: 'IN_PROGRESS', invoice: created };
  });
}

export async function scheduleChargeInvoice(
  input: ScheduleChargeInvoiceInput,
): Promise<Result<ScheduleChargeInvoiceOutput, ScheduleChargeInvoiceError>> {
  const prisma = getFiscalPrisma();

  try {
    const enabled = await featureFlagsService.isEnabled(input.contaId, 'enableInvoices');
    if (!enabled) return err('FEATURE_DISABLED');

    const kyc = await requireKycApproved(input.contaId);
    if (!kyc.success) return err('KYC_NAO_APROVADO');

    const credentials = await loadAsaasCredentials(input.contaId);
    if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

    const [settings, services, municipalOptions] = await Promise.all([
      prisma.contaFiscalSettings.findUnique({ where: { contaId: input.contaId } }),
      prisma.fiscalService.findMany({ where: { contaId: input.contaId } }),
      asaasGetMunicipalOptions({ apiKey: credentials.apiKey }).catch(() => null),
    ]);

    const readiness = computeFiscalReadiness({
      settings,
      services,
      municipalOptions,
      kycApproved: true,
      invoicesEnabled: true,
    });
    if (!readiness.ready) return err('FISCAL_NOT_READY');

    const defaultService = services.find((service) => service.isDefault);
    if (!settings || !defaultService) return err('FISCAL_NOT_READY');

    if (!settings.simplesNacional) {
      const issues = validateFiscalIbsCbs(defaultService);
      if (issues.length > 0) {
        return err({ kind: 'VALIDATION', message: issues[0]!.message });
      }
    }

    const retainedPis = Number(defaultService.pis);
    const retainedCofins = Number(defaultService.cofins);
    const operationPis = defaultService.operationPis == null ? null : Number(defaultService.operationPis);
    const operationCofins =
      defaultService.operationCofins == null ? null : Number(defaultService.operationCofins);
    const taxIssues = validateAsaasInvoiceTaxesInput({
      simplesNacional: settings.simplesNacional,
      useNationalPortal: Boolean(settings.useNationalPortal),
      pisCofinsTaxStatus: defaultService.pisCofinsTaxStatus,
      pis: retainedPis,
      cofins: retainedCofins,
      operationPis,
      operationCofins,
      retainIss: defaultService.retainIss,
      iss: Number(defaultService.iss),
      csll: Number(defaultService.csll),
      inss: Number(defaultService.inss),
      ir: Number(defaultService.ir),
    });
    if (taxIssues.length > 0) {
      return err({
        kind: 'VALIDATION',
        message: taxIssues[0]?.message ?? 'Revise PIS/COFINS do serviço fiscal padrão.',
      });
    }

    const chargeContext = await resolveChargeInvoiceContext(input.chargeId, input.contaId);
    if (!chargeContext) return err('CHARGE_NAO_ENCONTRADO');
    if (!chargeContext.charge.asaasPaymentId) return err('CHARGE_SEM_PAGAMENTO_ASAAS');

    const payerReadiness = await evaluateChargePayerFiscalReadiness({
      contaId: input.contaId,
      chargeId: input.chargeId,
    });
    if (payerReadiness.responsavelId) {
      const synced = await syncResponsavelAsaasCustomer({
        contaId: input.contaId,
        responsavelId: payerReadiness.responsavelId,
        requireFiscalAddress: true,
        notificationSyncMode: 'skip',
      });
      if (!synced.ok) {
        return err({
          kind: 'VALIDATION',
          message: synced.message,
        });
      }
    } else if (!payerReadiness.ready && payerReadiness.issues.length > 0) {
      return err({
        kind: 'VALIDATION',
        message: payerReadiness.issues[0]?.message ?? 'Endereço do pagador incompleto para emissão de NFS-e.',
      });
    }

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

    await ensureWebhookConfigOperational(input.contaId);

    const asaasPayment = await asaasGetPayment({
      apiKey: credentials.apiKey,
      paymentId: chargeContext.charge.asaasPaymentId,
    });

    const existing = await prisma.invoice.findUnique({
      where: { chargeId: chargeContext.charge.id },
      select: {
        id: true,
        status: true,
        asaasInvoiceId: true,
        operationStatus: true,
        operationLeaseExpiresAt: true,
      },
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
      invoice:
        existing?.asaasInvoiceId || existing?.status === 'ERROR'
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

    const invoiceId = chargeContext.charge.id;
    const externalReference = buildCanonicalInvoiceExternalReference(invoiceId);
    const taxes = buildAsaasInvoiceTaxes({
      simplesNacional: settings.simplesNacional,
      useNationalPortal: settings.useNationalPortal,
      retainIss: defaultService.retainIss,
      cofins: retainedCofins,
      csll: Number(defaultService.csll),
      inss: Number(defaultService.inss),
      ir: Number(defaultService.ir),
      pis: retainedPis,
      iss: Number(defaultService.iss),
      nbsCode: defaultService.nbsCode,
      taxSituationCode: defaultService.taxSituationCode,
      taxClassificationCode: defaultService.taxClassificationCode,
      operationIndicatorCode: defaultService.operationIndicatorCode,
      pisCofinsTaxStatus: defaultService.pisCofinsTaxStatus,
      operationPis,
      operationCofins,
      useTaxSystemReformNT007: defaultService.useTaxSystemReformNT007,
    });
    const usesProviderMunicipalService = Boolean(defaultService.asaasMunicipalServiceId);
    const municipalServiceId = usesProviderMunicipalService
      ? defaultService.asaasMunicipalServiceId
      : null;
    const municipalServiceCode = usesProviderMunicipalService
      ? null
      : defaultService.municipalServiceCode;
    const ibsCbs = !settings.simplesNacional
      ? buildAsaasInvoiceIbsCbs(defaultService) ?? undefined
      : undefined;

    if (existing && !existing.asaasInvoiceId) {
      const recovered = await recoverInvoiceByExternalReference({
        contaId: input.contaId,
        apiKey: credentials.apiKey,
        invoiceId: existing.id,
        previousStatus: existing.status,
        externalReference,
      }).catch(() => null);
      if (recovered) return ok(toOutput(recovered));
    }

    const claim = await claimInvoiceCreation({
      contaId: input.contaId,
      chargeId: chargeContext.charge.id,
      externalReference,
      invoiceUpdateData: {
        externalReference,
        status: 'SCHEDULED',
        statusUpdatedAt: new Date(),
        serviceDescription,
        observations,
        taxes: taxes as unknown as Prisma.InputJsonObject,
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
        fiscalDivergence: false,
      },
      invoiceData: {
        id: invoiceId,
        contaId: input.contaId,
        chargeId: chargeContext.charge.id,
        externalReference,
        status: 'SCHEDULED',
        serviceDescription,
        observations,
        taxes: taxes as unknown as Prisma.InputJsonObject,
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
    });

    if (claim.kind === 'EXISTING') {
      return ok(toOutput(claim.invoice));
    }

    if (claim.kind === 'IN_PROGRESS') {
      return ok(toOutput(claim.invoice));
    }

    try {
      const asaasInvoice = await asaasCreateInvoice({
        apiKey: credentials.apiKey,
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
          ibsCbs,
        },
      });

      const updated = await persistAsaasInvoiceResult({
        contaId: input.contaId,
        invoiceId: claim.invoice.id,
        previousStatus: claim.invoice.status,
        asaasInvoice,
        action: 'invoice.scheduled',
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
          operationAttempts: claim.invoice.operationAttempts,
        },
      });

      return ok(toOutput(updated));
    } catch (error) {
      const failure = classifyInvoiceAttemptError(error);

      if (failure.ambiguous) {
        const recovered = await recoverInvoiceByExternalReference({
          contaId: input.contaId,
          apiKey: credentials.apiKey,
          invoiceId: claim.invoice.id,
          previousStatus: claim.invoice.status,
          externalReference,
        }).catch(() => null);
        if (recovered) {
          await auditLogService.record({
            contaId: input.contaId,
            actor: input.actor,
            action: 'finance.invoice.recovered_after_ambiguous_result',
            entity: { type: 'Invoice', id: recovered.id },
            metadata: {
              chargeId: recovered.chargeId,
              externalReference: recovered.externalReference,
              asaasInvoiceId: recovered.asaasInvoiceId,
              status: recovered.status,
              errorKind: failure.kind,
            },
          });
          return ok(toOutput(recovered));
        }
      }

      await markAttemptFailure({
        contaId: input.contaId,
        invoiceId: claim.invoice.id,
        previousStatus: claim.invoice.status,
        failure,
      });

      return err({
        kind: failure.kind,
        message: failure.message,
        status: failure.status,
      });
    }
  } catch (error) {
    console.error('[finance][scheduleChargeInvoice]', error);
    return err('ERRO_AO_AGENDAR_INVOICE');
  }
}
