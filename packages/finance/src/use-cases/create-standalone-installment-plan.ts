import { prisma, loadAsaasCredentials } from '@alusa/database';
import { createInstallment, listInstallmentPayments, listPayments, type BillingType } from '@alusa/asaas';
import { resolvePayer } from '@alusa/domain';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';

import { auditLogService } from '../foundation/audit-log.service';
import { featureFlagsService } from '../foundation/feature-flags.service';
import { requireKycApproved } from '../foundation/kyc-guard';
import { assertAsaasTenantOperational } from '../foundation/asaas-operational-guard';
import { isPastDate } from '../foundation/date-guard';
import {
  buildInstallmentExternalReference,
  buildPaymentExternalReference,
  deriveDeterministicId,
  hashPayload,
  mapAsaasToChargeStatus,
  withIdempotencyGuard,
} from '../core';
import type { InstallmentStatus } from '@prisma/client';
import { chargeReadModelService } from '../read-model/charge-read-model.service';
import { normalizeAsaasPaymentSnapshotStatus } from '../mappers/asaas-payment-snapshot-status';
import { resolveLiquidacaoFromAsaasPayment } from '../mappers/liquidacao-from-asaas';
import { getInstallment } from './asaas-ops';
import {
  markOutboundAwaitingWebhook,
  markOutboundRemoteConfirmed,
  markOutboundRemoteRequested,
  markOutboundResultUnknown,
  reserveOutboundFinancialOperation,
} from './outbound-financial-operation';

export type CreateStandaloneInstallmentInput = {
  contaId: string;
  payer:
    | { type: 'aluno'; alunoId: string }
    | { type: 'responsavel'; responsavelId: string };
  installmentCount: number;
  billingType: BillingType;
  value: number;
  firstDueDate: string;
  description?: string;
  discount?: {
    value: number;
    dueDateLimitDays?: number;
    type?: 'FIXED' | 'PERCENTAGE';
  };
  interest?: {
    value: number;
  };
  fine?: {
    value: number;
    type?: 'FIXED' | 'PERCENTAGE';
  };
  uiRequestId?: string;
  actor: { type: 'USER' | 'SYSTEM'; id?: string };
};

export type CreateStandaloneInstallmentOutput = {
  installmentPlanId: string;
  externalReference: string;
  asaasInstallmentId: string | null;
  status: InstallmentStatus;
  createdAt: string;
  statusUpdatedAt: string;
};

export type CreateStandaloneInstallmentError =
  | 'FEATURE_DISABLED'
  | 'KYC_NAO_APROVADO'
  | 'PAGADOR_NAO_ENCONTRADO'
  | 'CUSTOMER_SEM_ASAAS_ID'
  | 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
  | 'FORMA_PAGAMENTO_INVALIDA'
  | 'VALOR_INVALIDO'
  | 'DATA_INVALIDA'
  | 'PARCELAS_INVALIDAS'
  | 'ERRO_AO_CRIAR_PARCELAMENTO'
  | 'ERRO_INTERNO';

type ResolvedStandaloneInstallmentPayer = {
  payerType: 'ALUNO' | 'RESPONSAVEL';
  payerId: string;
  displayName: string;
  financialPayerName: string;
};

function paymentRulesSnapshot(input: Pick<CreateStandaloneInstallmentInput, 'interest' | 'fine' | 'discount'>) {
  return {
    interestValue: input.interest?.value ?? null,
    fineValue: input.fine?.value ?? null,
    fineType: input.fine?.type ?? null,
    discountValue: input.discount?.value ?? null,
    discountType: input.discount?.type ?? null,
    discountDueDateLimitDays: input.discount?.dueDateLimitDays ?? null,
  };
}

export async function createStandaloneInstallmentPlan(
  input: CreateStandaloneInstallmentInput
): Promise<Result<CreateStandaloneInstallmentOutput, CreateStandaloneInstallmentError>> {
  try {
    const enabled = await featureFlagsService.isEnabled(input.contaId, 'enableInstallments');
    if (!enabled) return err('FEATURE_DISABLED');

    const kyc = await requireKycApproved(input.contaId, { allowPendingBankAccount: true });
    if (!kyc.success) return err('KYC_NAO_APROVADO');

    try {
      await assertAsaasTenantOperational(input.contaId);
    } catch {
      return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');
    }

    if (input.installmentCount < 2) return err('PARCELAS_INVALIDAS');
    if (!input.value || input.value <= 0) return err('VALOR_INVALIDO');
    if (!input.firstDueDate) return err('DATA_INVALIDA');
    if (isPastDate(input.firstDueDate)) return err('DATA_INVALIDA');

    if (input.billingType === 'UNDEFINED') return err('FORMA_PAGAMENTO_INVALIDA');

    const payerResolved = await resolvePayerFromInput(input);
    if (!payerResolved) return err('PAGADOR_NAO_ENCONTRADO');

    const customer = await prisma.customer.findUnique({
      where: {
        contaId_payerType_payerId: {
          contaId: input.contaId,
          payerType: payerResolved.payerType,
          payerId: payerResolved.payerId,
        },
      },
      select: { id: true, asaasCustomerId: true },
    });

    if (!customer?.asaasCustomerId) return err('CUSTOMER_SEM_ASAAS_ID');

    const idempotencyKey = input.uiRequestId ?? buildIdempotencyKey(input, payerResolved.payerId);
    const existing = await prisma.standaloneInstallmentPlan.findUnique({
      where: { contaId_idempotencyKey: { contaId: input.contaId, idempotencyKey } },
      select: {
        id: true,
        externalReference: true,
        asaasInstallmentId: true,
        status: true,
        createdAt: true,
        statusUpdatedAt: true,
      },
    });

    if (existing?.asaasInstallmentId) {
      await prisma.standaloneInstallmentPlan.update({
        where: { id: existing.id },
        data: paymentRulesSnapshot(input),
      });
      await syncInstallmentPayments({
        contaId: input.contaId,
        customerId: customer.id,
        payerName: payerResolved.displayName,
        installmentPlanId: existing.id,
        externalReference: existing.externalReference,
        asaasInstallmentId: existing.asaasInstallmentId,
        billingType: input.billingType,
        description: input.description ?? null,
        paymentRules: paymentRulesSnapshot(input),
      });

      return ok({
        installmentPlanId: existing.id,
        externalReference: existing.externalReference,
        asaasInstallmentId: existing.asaasInstallmentId,
        status: existing.status,
        createdAt: existing.createdAt.toISOString(),
        statusUpdatedAt: existing.statusUpdatedAt.toISOString(),
      });
    }

    const installmentPlanId = existing?.id ?? deriveDeterministicId('sip', idempotencyKey);
    const externalReference = existing?.externalReference ?? buildInstallmentExternalReference({
      installmentPlanId,
    });

    const credentials = await loadAsaasCredentials(input.contaId);
    if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

    // Asaas: `value` = valor de CADA parcela; `totalValue` = valor total
    // input.value = valor TOTAL informado pelo usuário
    const installmentValue = Math.round((input.value / input.installmentCount) * 100) / 100;

    const asaasPayload = {
      customer: customer.asaasCustomerId,
      installmentCount: input.installmentCount,
      billingType: input.billingType,
      value: installmentValue,
      totalValue: input.value,
      dueDate: input.firstDueDate,
      paymentExternalReference: externalReference,
      ...(input.description != null && { description: input.description }),
      ...(input.discount != null && { discount: input.discount }),
      ...(input.interest != null && { interest: input.interest }),
      ...(input.fine != null && { fine: input.fine }),
    };

    const operation = await reserveOutboundFinancialOperation({
      contaId: input.contaId,
      type: 'CREATE_INSTALLMENT',
      idempotencyKey,
      resource: 'INSTALLMENT_PLAN',
      entityId: installmentPlanId,
      externalReference,
      requestFingerprint: hashPayload(asaasPayload),
    });
    let asaasInstallment = operation.payload.remoteId
      ? await getInstallment(operation.payload.remoteId, { contaId: input.contaId }).catch(() => null)
      : null;

    if (!asaasInstallment) {
      const recoveredPayments = await listPayments({
        apiKey: credentials.apiKey,
        externalReference,
        limit: 100,
        includeDeleted: true,
      }).then((result) => result.data).catch(() => []);
      const installmentIds = [...new Set(recoveredPayments.map((payment) => payment.installment).filter((id): id is string => Boolean(id)))];
      if (installmentIds.length > 1) {
        await markOutboundResultUnknown({ jobId: operation.job.id, contaId: input.contaId, resource: 'INSTALLMENT_PLAN', entityId: installmentPlanId, externalReference, error: 'MULTIPLE_REMOTE_INSTALLMENTS_FOR_EXTERNAL_REFERENCE' });
        return err('ERRO_AO_CRIAR_PARCELAMENTO');
      }
      if (installmentIds[0]) {
        asaasInstallment = await getInstallment(installmentIds[0], { contaId: input.contaId }).catch(() => null);
      }
    }

    if (!asaasInstallment) {
      const claimed = await markOutboundRemoteRequested(operation.job.id);
      if (!claimed) return err('ERRO_AO_CRIAR_PARCELAMENTO');
      try {
        const created = await createInstallment({
          apiKey: credentials.apiKey,
          idempotencyKey: externalReference,
          data: asaasPayload,
        });
        asaasInstallment = await getInstallment(created.id, { contaId: input.contaId }).catch(() => created);
      } catch (remoteError) {
        const recoveredPayments = await listPayments({
          apiKey: credentials.apiKey,
          externalReference,
          limit: 100,
          includeDeleted: true,
        }).then((result) => result.data).catch(() => []);
        const installmentIds = [...new Set(recoveredPayments.map((payment) => payment.installment).filter((id): id is string => Boolean(id)))];
        if (installmentIds.length === 1) {
          asaasInstallment = await getInstallment(installmentIds[0]!, { contaId: input.contaId }).catch(() => null);
        }
        if (!asaasInstallment) {
          await markOutboundResultUnknown({ jobId: operation.job.id, contaId: input.contaId, resource: 'INSTALLMENT_PLAN', entityId: installmentPlanId, externalReference, error: remoteError });
          return err('ERRO_AO_CRIAR_PARCELAMENTO');
        }
      }
    }
    const installmentMismatch = !asaasInstallment?.id
      || (asaasInstallment.customer != null && asaasInstallment.customer !== customer.asaasCustomerId)
      || (asaasInstallment.installmentCount != null && asaasInstallment.installmentCount !== input.installmentCount)
      || (asaasInstallment.value != null && Math.abs(asaasInstallment.value - input.value) > 0.001);
    if (installmentMismatch) {
      await markOutboundResultUnknown({ jobId: operation.job.id, contaId: input.contaId, resource: 'INSTALLMENT_PLAN', entityId: installmentPlanId, externalReference, error: 'REMOTE_INSTALLMENT_CONFIRMATION_MISMATCH' });
      return err('ERRO_AO_CRIAR_PARCELAMENTO');
    }
    await markOutboundRemoteConfirmed(operation.job.id, asaasInstallment.id);

    const firstDueDate = new Date(`${input.firstDueDate}T00:00:00.000Z`);

    const updated = await withIdempotencyGuard({
      contaId: input.contaId,
      scope: 'installment-create',
      key: idempotencyKey,
      fn: async (tx) => {
        const current = await tx.standaloneInstallmentPlan.findUnique({
          where: { contaId_idempotencyKey: { contaId: input.contaId, idempotencyKey } },
          select: {
            id: true,
            externalReference: true,
            asaasInstallmentId: true,
            status: true,
            createdAt: true,
            statusUpdatedAt: true,
          },
        });

        if (current?.asaasInstallmentId) return current;

        if (current) {
          return tx.standaloneInstallmentPlan.update({
            where: { id: current.id },
            data: {
              externalReference,
              idempotencyKey,
              asaasInstallmentId: asaasInstallment.id,
              status: 'ACTIVE',
              statusUpdatedAt: new Date(),
              installmentCount: input.installmentCount,
              billingType: input.billingType,
              value: input.value,
              firstDueDate,
              ...paymentRulesSnapshot(input),
            },
            select: {
              id: true,
              externalReference: true,
              asaasInstallmentId: true,
              status: true,
              createdAt: true,
              statusUpdatedAt: true,
            },
          });
        }

        return tx.standaloneInstallmentPlan.create({
          data: {
            id: installmentPlanId,
            contaId: input.contaId,
            customerId: customer.id,
            externalReference,
            idempotencyKey,
            status: 'ACTIVE',
            installmentCount: input.installmentCount,
            billingType: input.billingType,
            value: input.value,
            firstDueDate,
            asaasInstallmentId: asaasInstallment.id,
            ...paymentRulesSnapshot(input),
          },
          select: {
            id: true,
            externalReference: true,
            asaasInstallmentId: true,
            status: true,
            createdAt: true,
            statusUpdatedAt: true,
          },
        });
      },
    });

    // `AsaasIntegrationJob.installmentPlanId` references the academic
    // `InstallmentPlan` model. Standalone parcelamentos belong to
    // `StandaloneInstallmentPlan` and must be correlated by the durable
    // operation payload/externalReference instead of writing an incompatible
    // id into that foreign key. The webhook resolver uses this correlation
    // to project each payment locally.
    await markOutboundAwaitingWebhook(operation.job.id, asaasInstallment.id);

    await syncInstallmentPayments({
      contaId: input.contaId,
      customerId: customer.id,
      payerName: payerResolved.displayName,
      installmentPlanId: updated.id,
      externalReference: updated.externalReference,
      asaasInstallmentId: updated.asaasInstallmentId!,
      billingType: input.billingType,
      description: input.description ?? null,
      paymentRules: paymentRulesSnapshot(input),
    });

    await auditLogService.record({
      contaId: input.contaId,
      actor: input.actor,
      action: 'finance.standalone_installment.requested',
      entity: { type: 'StandaloneInstallmentPlan', id: updated.id },
      metadata: {
        externalReference: updated.externalReference,
        installmentCount: input.installmentCount,
        billingType: input.billingType,
        value: input.value,
        firstDueDate: input.firstDueDate,
        description: input.description ?? null,
        payerType: payerResolved.payerType,
        payerId: payerResolved.payerId,
        payerName: payerResolved.financialPayerName,
        displayName: payerResolved.displayName,
      },
    });

    return ok({
      installmentPlanId: updated.id,
      externalReference: updated.externalReference,
      asaasInstallmentId: updated.asaasInstallmentId ?? null,
      status: updated.status,
      createdAt: updated.createdAt.toISOString(),
      statusUpdatedAt: updated.statusUpdatedAt.toISOString(),
    });
  } catch (error) {
    console.error('[finance][createStandaloneInstallmentPlan]', error);
    return err('ERRO_INTERNO');
  }
}

async function resolvePayerFromInput(input: CreateStandaloneInstallmentInput): Promise<ResolvedStandaloneInstallmentPayer | null> {
  if (input.payer.type === 'responsavel') {
    const responsavel = await prisma.responsavel.findFirst({
      where: { id: input.payer.responsavelId, contaId: input.contaId },
      select: { id: true, nome: true },
    });
    if (!responsavel) return null;
    return {
      payerType: 'RESPONSAVEL',
      payerId: responsavel.id,
      displayName: responsavel.nome,
      financialPayerName: responsavel.nome,
    };
  }

  const aluno = await prisma.aluno.findFirst({
    where: { id: input.payer.alunoId, contaId: input.contaId },
    select: {
      id: true,
      nome: true,
      dataNasc: true,
      responsaveis: {
        where: {
          OR: [
            { responsavel: { financeiro: true } },
            { tipoVinculo: { in: ['FINANCEIRO', 'PRINCIPAL'] } },
          ],
        },
        select: { responsavelId: true },
        take: 1,
      },
    },
  });

  if (!aluno) return null;

  const resolved = resolvePayer({
    alunoId: aluno.id,
    alunoDataNasc: aluno.dataNasc,
    responsavelFinanceiroId: aluno.responsaveis[0]?.responsavelId ?? null,
  });

  if (!resolved.success) return null;

  if (resolved.payer.type === 'ALUNO') {
    return {
      payerType: 'ALUNO',
      payerId: resolved.payer.id,
      displayName: aluno.nome,
      financialPayerName: aluno.nome,
    };
  }

  const responsavel = await prisma.responsavel.findFirst({
    where: { id: resolved.payer.id, contaId: input.contaId },
    select: { nome: true },
  });

  return {
    payerType: 'RESPONSAVEL',
    payerId: resolved.payer.id,
    displayName: aluno.nome,
    financialPayerName: responsavel?.nome ?? aluno.nome,
  };
}

function buildIdempotencyKey(input: CreateStandaloneInstallmentInput, payerId: string): string {
  const hash = hashPayload({
    contaId: input.contaId,
    payerId,
    billingType: input.billingType,
    installmentCount: input.installmentCount,
    value: input.value,
    firstDueDate: input.firstDueDate,
  });

  return `standalone-installment:${hash}`;
}

async function syncInstallmentPayments(params: {
  contaId: string;
  customerId: string;
  payerName: string | null;
  installmentPlanId: string;
  externalReference: string;
  asaasInstallmentId: string;
  billingType: BillingType;
  description: string | null;
  paymentRules: ReturnType<typeof paymentRulesSnapshot>;
}) {
  const { contaId, customerId, payerName, installmentPlanId, externalReference, asaasInstallmentId, billingType, description, paymentRules } = params;
  const credentials = await loadAsaasCredentials(contaId);
  if (!credentials) return;

  const paymentsResponse = await listInstallmentPayments({
    apiKey: credentials.apiKey,
    installmentId: asaasInstallmentId,
    limit: 100,
    offset: 0,
  }).catch((e) => {
    console.error('[finance][createStandaloneInstallmentPlan][listInstallmentPayments]', e);
    return null;
  });

  const payments = paymentsResponse?.data ?? [];
  if (!payments.length) return;

  const sortedPayments = [...payments].sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  for (const payment of sortedPayments) {
    const vencimento = new Date(payment.dueDate);
    const paymentExternalReference = buildPaymentExternalReference(externalReference, payment.id);
    const effectivePaymentStatus =
      normalizeAsaasPaymentSnapshotStatus({
        status: payment.status,
        billingType: payment.billingType,
        deleted: payment.deleted,
      }) ?? payment.status;
    const asaasSnapshot = {
      asaasStatus: effectivePaymentStatus,
      asaasValue: payment.value,
      asaasNetValue: payment.netValue,
      asaasOriginalValue: payment.originalValue ?? null,
      asaasFeeValue: payment.value - payment.netValue,
      asaasCreditDate: payment.creditDate ? new Date(payment.creditDate) : null,
      asaasEstimatedCreditDate: payment.estimatedCreditDate ? new Date(payment.estimatedCreditDate) : null,
      lastAsaasFetchAt: new Date(),
      liquidacaoStatus: resolveLiquidacaoFromAsaasPayment({
        asaasStatus: effectivePaymentStatus,
        creditDate: payment.creditDate,
        billingType: payment.billingType,
      }),
    };

    const syncedCharge = await prisma.charge.upsert({
      where: {
        uq_charge_conta_asaas_payment: {
          contaId,
          asaasPaymentId: payment.id,
        },
      },
      update: {
        externalReference: paymentExternalReference,
        status: mapAsaasToChargeStatus(effectivePaymentStatus),
        statusUpdatedAt: new Date(),
        payerName,
        description: payment.description ?? description,
        value: payment.value,
        dueDate: vencimento,
        billingType: payment.billingType ?? billingType,
        customerId,
        invoiceUrl: payment.invoiceUrl ?? null,
        standaloneInstallmentPlanId: installmentPlanId,
        ...paymentRules,
        ...asaasSnapshot,
      },
      create: {
        contaId,
        externalReference: paymentExternalReference,
        status: mapAsaasToChargeStatus(effectivePaymentStatus),
        statusUpdatedAt: new Date(),
        asaasPaymentId: payment.id,
        payerName,
        description: payment.description ?? description,
        value: payment.value,
        dueDate: vencimento,
        billingType: payment.billingType ?? billingType,
        customerId,
        invoiceUrl: payment.invoiceUrl ?? null,
        standaloneInstallmentPlanId: installmentPlanId,
        ...paymentRules,
        ...asaasSnapshot,
      },
    });

    await chargeReadModelService.projectChargeReadModelByChargeId(syncedCharge.id);
  }
}
