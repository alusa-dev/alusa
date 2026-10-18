import { logFinanceOperationalEvent } from '../foundation/operational-log';
import { prisma, loadAsaasCredentials } from '@alusa/database';
import {
  createInstallment as asaasCreateInstallment,
  listInstallmentPayments,
  type BillingType,
} from '@alusa/asaas';
import type { InstallmentStatus } from '@prisma/client';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';
import { resolvePayer } from '@alusa/domain';

import { auditLogService } from '../foundation/audit-log.service';
import { featureFlagsService } from '../foundation/feature-flags.service';
import { requireKycApproved } from '../foundation/kyc-guard';
import { assertAsaasTenantOperational } from '../foundation/asaas-operational-guard';
import { isPastDate } from '../foundation/date-guard';
import { ensureCustomer } from './ensure-customer';
import {
  buildInstallmentExternalReference,
  buildPaymentExternalReference,
  deriveDeterministicId,
  hashPayload,
  toFormaPagamento,
} from '../core';
import {
  mapAsaasPaymentStatusToCobranca,
  mapAsaasPaymentStatusToCharge,
} from '../mappers/charge-status/asaas-to-internal';
import { resolveLiquidacaoFromAsaasPayment } from '../mappers/liquidacao-from-asaas';
import { ensureWebhookConfigOperational } from '../webhooks/ensure-webhook-config-operational';
import { normalizeAsaasPaymentSnapshotStatus } from '../mappers/asaas-payment-snapshot-status';
import { parseCivilDatePreservingInstant, parseOptionalCivilDatePreservingInstant } from '../mappers/civil-date';
import { getInstallment, listPayments } from './asaas-ops';
import {
  markOutboundAwaitingWebhook,
  markOutboundFailed,
  markOutboundRemoteConfirmed,
  markOutboundRemoteRequested,
  markOutboundRequiresReconciliation,
  markOutboundResultUnknown,
  reserveOutboundFinancialOperation,
} from './outbound-financial-operation';
import { assertCompleteAsaasPage } from './asaas-pagination';

export type CreateInstallmentPlanInput = {
  contaId: string;
  contratoId: string;
  matriculaId: string;

  installmentCount: number;
  billingType: BillingType;
  value: number;
  firstDueDate: string; // YYYY-MM-DD
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

  actor: { type: 'USER' | 'SYSTEM' | 'ADMIN'; id?: string };
};

export type CreateInstallmentPlanOutput = {
  installmentPlanId: string;
  externalReference: string;
  asaasInstallmentId: string | null;
  status: InstallmentStatus;
  createdAt: string;
  statusUpdatedAt: string;
};

export type CreateInstallmentPlanError =
  | 'FEATURE_DISABLED'
  | 'KYC_NAO_APROVADO'
  | 'MATRICULA_NAO_ENCONTRADA'
  | 'CONTRATO_NAO_ENCONTRADO'
  | 'PARCELAMENTO_CONFLITANTE'
  | 'PAGADOR_NAO_ENCONTRADO'
  | 'PAGADOR_SEM_CPF'
  | 'ASAAS_CUSTOMER_INVALIDO'
  | 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
  | 'ERRO_AO_CRIAR_CUSTOMER'
  | 'ERRO_AO_CRIAR_PARCELAMENTO'
  | 'DATA_INVALIDA'
  | 'ERRO_INTERNO';

export async function createInstallmentPlan(
  input: CreateInstallmentPlanInput,
): Promise<Result<CreateInstallmentPlanOutput, CreateInstallmentPlanError>> {
  try {
    const enabled = await featureFlagsService.isEnabled(input.contaId, 'enableInstallments');
    if (!enabled) return err('FEATURE_DISABLED');

    const kyc = await requireKycApproved(input.contaId);
    if (!kyc.success)
      return err(kyc.error === 'KYC_NAO_APROVADO' ? 'KYC_NAO_APROVADO' : 'ERRO_INTERNO');

    try {
      await assertAsaasTenantOperational(input.contaId);
    } catch {
      return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');
    }

    const matricula = await prisma.matricula.findFirst({
      where: { id: input.matriculaId, aluno: { contaId: input.contaId } },
      select: {
        id: true,
        alunoId: true,
        responsavelFinanceiroId: true,
        aluno: { select: { id: true, dataNasc: true } },
      },
    });

    if (!matricula) return err('MATRICULA_NAO_ENCONTRADA');

    const contrato = await prisma.contrato.findFirst({
      where: { id: input.contratoId, matriculaId: matricula.id },
      select: { id: true },
    });

    if (!contrato) return err('CONTRATO_NAO_ENCONTRADO');

    const existingByContrato = await prisma.installmentPlan.findUnique({
      where: { contaId_contratoId: { contaId: input.contaId, contratoId: input.contratoId } },
      select: {
        id: true,
        contratoId: true,
        matriculaId: true,
        externalReference: true,
        asaasInstallmentId: true,
        status: true,
        createdAt: true,
        statusUpdatedAt: true,
      },
    });

    const existingByMatricula = existingByContrato
      ? null
      : await prisma.installmentPlan.findUnique({
          where: {
            contaId_matriculaId: { contaId: input.contaId, matriculaId: input.matriculaId },
          },
          select: {
            id: true,
            contratoId: true,
            matriculaId: true,
            externalReference: true,
            asaasInstallmentId: true,
            status: true,
            createdAt: true,
            statusUpdatedAt: true,
          },
        });

    const existing = existingByContrato ?? existingByMatricula;

    if (existing) {
      if (existing.contratoId !== input.contratoId || existing.matriculaId !== input.matriculaId) {
        return err('PARCELAMENTO_CONFLITANTE');
      }

      // Idempotência: plano ACTIVE com asaasInstallmentId → retorna o existente
      // Planos COMPLETED/CANCELED podem ser recriados
      if (existing.asaasInstallmentId && existing.status === 'ACTIVE') {
        return ok({
          installmentPlanId: existing.id,
          externalReference: existing.externalReference,
          asaasInstallmentId: existing.asaasInstallmentId,
          status: existing.status,
          createdAt: existing.createdAt.toISOString(),
          statusUpdatedAt: existing.statusUpdatedAt.toISOString(),
        });
      }
    }

    // Usar função canônica do domínio para determinar o pagador
    const payerResult = resolvePayer({
      alunoId: matricula.aluno.id,
      alunoDataNasc: matricula.aluno.dataNasc,
      responsavelFinanceiroId: matricula.responsavelFinanceiroId,
    });

    if (!payerResult.success) {
      // Menor de idade sem responsável
      return err('PAGADOR_NAO_ENCONTRADO');
    }

    const payer = payerResult.payer;

    const customerResult = await ensureCustomer({ contaId: input.contaId, payer });
    if (!customerResult.success) {
      if (customerResult.error === 'PAGADOR_NAO_ENCONTRADO') return err('PAGADOR_NAO_ENCONTRADO');
      if (customerResult.error === 'PAGADOR_SEM_CPF') return err('PAGADOR_SEM_CPF');
      if (customerResult.error === 'ASAAS_CUSTOMER_INVALIDO') return err('ASAAS_CUSTOMER_INVALIDO');
      if (customerResult.error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS')
        return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');
      return err('ERRO_AO_CRIAR_CUSTOMER');
    }

    const firstDueDate = new Date(`${input.firstDueDate}T00:00:00.000Z`);
    if (Number.isNaN(firstDueDate.getTime())) return err('DATA_INVALIDA');
    if (isPastDate(input.firstDueDate)) return err('DATA_INVALIDA');

    const isRecreation =
      existing && (existing.status === 'COMPLETED' || existing.status === 'CANCELED');
    const idempotencySeed = `installment:${input.contaId}:${input.contratoId}`;
    const installmentPlanId = existing?.id ?? deriveDeterministicId('ip', idempotencySeed);
    // Recriações têm uma intenção nova, mas a referência também precisa ser
    // repetível enquanto o plano terminal continuar sendo o mesmo.
    const recreationId = isRecreation
      ? deriveDeterministicId('ipr', `${installmentPlanId}:${existing.statusUpdatedAt.toISOString()}`)
      : installmentPlanId;
    const externalReference = isRecreation
      ? buildInstallmentExternalReference({ installmentPlanId: recreationId })
      : existing?.externalReference ?? buildInstallmentExternalReference({ installmentPlanId });

    await ensureWebhookConfigOperational(input.contaId);

    const credentials = await loadAsaasCredentials(input.contaId);
    if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

    const asaasPayload = {
      customer: customerResult.data.customerId,
      installmentCount: input.installmentCount,
      billingType: input.billingType,
      value: input.value,
      dueDate: input.firstDueDate,
      ...(input.description != null && { description: input.description }),
      paymentExternalReference: externalReference,
      ...(input.discount != null && { discount: input.discount }),
      ...(input.interest != null && { interest: input.interest }),
      ...(input.fine != null && { fine: input.fine }),
    };
    const operation = await reserveOutboundFinancialOperation({
      contaId: input.contaId,
      type: 'CREATE_INSTALLMENT',
      idempotencyKey: `${idempotencySeed}:${externalReference}`,
      resource: 'INSTALLMENT_PLAN',
      entityId: installmentPlanId,
      externalReference,
      requestFingerprint: hashPayload(asaasPayload),
      metadata: { contratoId: input.contratoId, matriculaId: input.matriculaId },
      links: { installmentPlanId },
    });

    let asaasInstallment = operation.payload.remoteId
      ? await getInstallment(operation.payload.remoteId, { contaId: input.contaId }).catch(() => null)
      : null;
    let remoteLookupAmbiguous = false;
    let remoteLookupError = 'MULTIPLE_REMOTE_INSTALLMENTS_FOR_EXTERNAL_REFERENCE';
    const findRemoteInstallment = async () => {
      const payments: Awaited<ReturnType<typeof listPayments>>['data'] = [];
      const seenPages = new Set<string>();
      const seenPaymentIds = new Set<string>();
      let expectedTotalCount: number | undefined;
      let complete = false;
      for (let page = 0; page < 10; page += 1) {
        const result = await listPayments({
          externalReference,
          limit: 100,
          offset: page * 100,
          includeDeleted: true,
        }, { contaId: input.contaId }).catch(() => null);
        if (!result) break;
        try {
          expectedTotalCount = assertCompleteAsaasPage(result, page * 100, 100, expectedTotalCount);
        } catch { break; }
        const pageIds = result.data.map((payment) => payment.id);
        const signature = pageIds.slice().sort().join('|');
        if (
          (result.hasMore && result.data.length === 0) ||
          seenPages.has(signature) ||
          pageIds.some((id) => seenPaymentIds.has(id))
        ) break;
        seenPages.add(signature);
        pageIds.forEach((id) => seenPaymentIds.add(id));
        payments.push(...result.data);
        if (!result.hasMore) {
          complete = true;
          break;
        }
      }
      const ids = [...new Set(payments.map((payment) => payment.installment).filter((id): id is string => Boolean(id)))];
      if (ids.length > 1) remoteLookupAmbiguous = true;
      if (payments.some((payment) => !payment.installment)) {
        remoteLookupAmbiguous = true;
        remoteLookupError = 'REMOTE_PAYMENTS_WITHOUT_INSTALLMENT_REFERENCE';
      }
      if (ids.length !== 1) {
        return { installment: null, complete: complete && payments.length === 0 };
      }
      const installment = await getInstallment(ids[0]!, { contaId: input.contaId }).catch(() => null);
      return {
        installment: complete ? installment : null,
        complete: complete && Boolean(installment),
      };
    };
    let remoteLookupComplete = false;
    if (!asaasInstallment) {
      const recovered = await findRemoteInstallment();
      asaasInstallment = recovered.installment;
      remoteLookupComplete = recovered.complete;
    }

    if (remoteLookupAmbiguous) {
      await markOutboundRequiresReconciliation({
        jobId: operation.job.id,
        contaId: input.contaId,
        resource: 'INSTALLMENT_PLAN',
        entityId: installmentPlanId,
        externalReference,
        error: remoteLookupError,
      });
      return err('ERRO_AO_CRIAR_PARCELAMENTO');
    }

    if (!asaasInstallment && !remoteLookupComplete) {
      if (operation.payload.state === 'INTENT_CREATED') {
        // Ainda não existe POST conhecido, então a intenção pode ser retomada
        // quando o preflight voltar a responder; não declare ausência remota.
        return err('ERRO_AO_CRIAR_PARCELAMENTO');
      }
      await markOutboundResultUnknown({
        jobId: operation.job.id,
        contaId: input.contaId,
        resource: 'INSTALLMENT_PLAN',
        entityId: installmentPlanId,
        externalReference,
        error: 'INSTALLMENT_RECONCILIATION_LOOKUP_INCOMPLETE',
      });
      return err('ERRO_AO_CRIAR_PARCELAMENTO');
    }

    if (!asaasInstallment && operation.payload.state !== 'INTENT_CREATED') {
      await markOutboundResultUnknown({
        jobId: operation.job.id,
        contaId: input.contaId,
        resource: 'INSTALLMENT_PLAN',
        entityId: installmentPlanId,
        externalReference,
        error: remoteLookupComplete
          ? 'PREVIOUS_INSTALLMENT_CREATE_RESULT_NOT_CONFIRMED'
          : 'INSTALLMENT_RECONCILIATION_LOOKUP_INCOMPLETE',
      });
      return err('ERRO_AO_CRIAR_PARCELAMENTO');
    }

    if (!asaasInstallment) {
      const claimed = await markOutboundRemoteRequested(operation.job.id);
      if (!claimed) return err('ERRO_AO_CRIAR_PARCELAMENTO');
      asaasInstallment = await asaasCreateInstallment({
        apiKey: credentials.apiKey,
        idempotencyKey: externalReference,
        data: asaasPayload,
      }).catch(async (e) => {
        const recovered = await findRemoteInstallment();
        if (recovered.installment) return recovered.installment;
        remoteLookupComplete = recovered.complete;
        if (remoteLookupAmbiguous) {
          await markOutboundRequiresReconciliation({
            jobId: operation.job.id,
            contaId: input.contaId,
            resource: 'INSTALLMENT_PLAN',
            entityId: installmentPlanId,
            externalReference,
            error: remoteLookupError,
          });
          return null;
        }
      // Extrair detalhes de erro do Asaas
      const asaasResponse = (e as { responseBody?: unknown })?.responseBody;
      const asaasErrors = (
        asaasResponse as { errors?: Array<{ code?: string; description?: string }> }
      )?.errors;
      const errorDetails = asaasErrors?.[0];

      const errorInfo = {
        contaId: input.contaId,
        contratoId: input.contratoId,
        matriculaId: input.matriculaId,
        message: e instanceof Error ? e.message : String(e),
        asaasErrorCode: errorDetails?.code,
        asaasErrorDescription: errorDetails?.description,
        externalReference,
        firstDueDate: input.firstDueDate,
      };
      logFinanceOperationalEvent({
        severity: 'error',
        eventName: 'finance.use_cases.create_installment_plan.failed',
        error: errorInfo,
        throttleMs: 60_000,
      });
        const status = typeof e === 'object' && e !== null && 'status' in e
          ? (e as { status?: unknown }).status
          : undefined;
        const definitiveRejection =
          typeof status === 'number' && status >= 400 && status < 500 &&
          ![408, 409, 425, 429].includes(status);
        if (definitiveRejection && remoteLookupComplete) {
          await markOutboundFailed(operation.job.id, e, { providerStatus: status });
          return null;
        }
        await markOutboundResultUnknown({
          jobId: operation.job.id,
          contaId: input.contaId,
          resource: 'INSTALLMENT_PLAN',
          entityId: installmentPlanId,
          externalReference,
          error: e,
        });
        return null;
      });
    }

    if (!asaasInstallment?.id) return err('ERRO_AO_CRIAR_PARCELAMENTO');
    const installmentMismatch =
      (asaasInstallment.customer != null && asaasInstallment.customer !== customerResult.data.customerId) ||
      (asaasInstallment.installmentCount != null && asaasInstallment.installmentCount !== input.installmentCount) ||
      (asaasInstallment.value != null && Math.abs(asaasInstallment.value - input.value) > 0.001);
    if (installmentMismatch) {
      await markOutboundRequiresReconciliation({
        jobId: operation.job.id,
        contaId: input.contaId,
        resource: 'INSTALLMENT_PLAN',
        entityId: installmentPlanId,
        externalReference,
        error: 'REMOTE_INSTALLMENT_CONFIRMATION_MISMATCH',
      });
      return err('ERRO_AO_CRIAR_PARCELAMENTO');
    }
    await markOutboundRemoteConfirmed(operation.job.id, asaasInstallment.id);

    // Resetar status para ACTIVE quando recria ou retenta
    const shouldResetStatus = isRecreation || Boolean(existing && !existing.asaasInstallmentId);

    const updated = existing
      ? await prisma.installmentPlan.update({
          where: { id: existing.id },
          data: {
            externalReference,
            asaasInstallmentId: asaasInstallment.id,
            status: shouldResetStatus ? 'ACTIVE' : undefined,
            statusUpdatedAt: new Date(),
            installmentCount: input.installmentCount,
            billingType: input.billingType,
            value: input.value,
            firstDueDate,
          },
          select: {
            id: true,
            externalReference: true,
            asaasInstallmentId: true,
            status: true,
            createdAt: true,
            statusUpdatedAt: true,
          },
        })
      : await prisma.installmentPlan.create({
          data: {
            id: installmentPlanId,
            contaId: input.contaId,
            contratoId: input.contratoId,
            matriculaId: input.matriculaId,
            externalReference,
            status: 'ACTIVE',
            installmentCount: input.installmentCount,
            billingType: input.billingType,
            value: input.value,
            firstDueDate,
            asaasInstallmentId: asaasInstallment.id,
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

    const payments: Awaited<ReturnType<typeof listInstallmentPayments>>['data'] = [];
    let expectedTotalCount: number | undefined;
    let offset = 0;
    let complete = false;
    try {
      for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
        const page = await listInstallmentPayments({
          apiKey: credentials.apiKey,
          installmentId: asaasInstallment.id,
          limit: 100,
          offset,
        });
        expectedTotalCount = assertCompleteAsaasPage(page, offset, 100, expectedTotalCount);
        payments.push(...page.data);
        if (!page.hasMore) { complete = true; break; }
        offset += 100;
      }
      if (!complete) throw new Error('ASAAS_INSTALLMENT_PAYMENTS_INCOMPLETE:PAGE_LIMIT_REACHED');
    } catch (e) {
      logFinanceOperationalEvent({
        severity: 'error',
        eventName: 'finance.use_cases.create_installment_plan.failed',
        error: e,
        throttleMs: 60_000,
      });
      return err('ERRO_AO_CRIAR_PARCELAMENTO');
    }

    await markOutboundAwaitingWebhook(operation.job.id, asaasInstallment.id);

    if (payments.length) {
      const sortedPayments = [...payments].sort((a, b) => a.dueDate.localeCompare(b.dueDate));

      for (let index = 0; index < sortedPayments.length; index += 1) {
        const payment = sortedPayments[index];
        const effectivePaymentStatus =
          normalizeAsaasPaymentSnapshotStatus({
            status: payment.status,
            billingType: payment.billingType,
            deleted: payment.deleted,
          }) ?? payment.status;

        const existingCobranca = await prisma.cobranca.findFirst({
          where: {
            matriculaId: input.matriculaId,
            OR: [{ asaasPaymentId: payment.id }, { asaasId: payment.id }],
          },
          select: { id: true },
        });

        if (existingCobranca) continue;

        const installmentNumber = index + 1;
        const vencimento = new Date(payment.dueDate);
        const competenciaInicio = new Date(vencimento.getFullYear(), vencimento.getMonth(), 1);
        const competenciaFim = new Date(vencimento.getFullYear(), vencimento.getMonth() + 1, 0);
        const descricao = input.description
          ? `${input.description} - Parcela ${installmentNumber}/${input.installmentCount}`
          : `Parcela ${installmentNumber}/${input.installmentCount}`;

        const cobranca = await prisma.cobranca.create({
          data: {
            contaId: input.contaId,
            matriculaId: input.matriculaId,
            tipo: 'PARCELADA',
            valor: payment.value,
            vencimento,
            status: mapAsaasPaymentStatusToCobranca(effectivePaymentStatus, {
              dueDate: vencimento,
            }),
            descricao,
            competenciaInicio,
            competenciaFim,
            asaasPaymentId: payment.id,
            asaasStatus: effectivePaymentStatus,
            asaasValue: payment.value,
            asaasNetValue: payment.netValue,
            asaasOriginalValue: payment.originalValue ?? null,
            asaasFeeValue: payment.value - payment.netValue,
            asaasCreditDate: parseCivilDatePreservingInstant(payment.creditDate),
            asaasEstimatedCreditDate: parseCivilDatePreservingInstant(payment.estimatedCreditDate),
            lastAsaasFetchAt: new Date(),
            liquidacaoStatus: resolveLiquidacaoFromAsaasPayment({
              asaasStatus: effectivePaymentStatus,
              creditDate: payment.creditDate,
              billingType: payment.billingType,
            }),
            formaPagamento: toFormaPagamento(payment.billingType ?? input.billingType),
          },
          select: { id: true },
        });

        const paymentExternalReference = buildPaymentExternalReference(
          updated.externalReference,
          payment.id,
        );
        const creditDate = parseOptionalCivilDatePreservingInstant(payment.creditDate);
        const estimatedCreditDate = parseOptionalCivilDatePreservingInstant(payment.estimatedCreditDate);
        const chargeSnapshot = {
          asaasStatus: effectivePaymentStatus,
          asaasValue: payment.value,
          asaasNetValue: payment.netValue,
          asaasOriginalValue: payment.originalValue ?? null,
          asaasFeeValue: payment.value - payment.netValue,
          ...(creditDate !== undefined ? { asaasCreditDate: creditDate } : {}),
          ...(estimatedCreditDate !== undefined ? { asaasEstimatedCreditDate: estimatedCreditDate } : {}),
          lastAsaasFetchAt: new Date(),
          ...(creditDate !== undefined ? { liquidacaoStatus: resolveLiquidacaoFromAsaasPayment({
            asaasStatus: effectivePaymentStatus,
            creditDate: payment.creditDate,
            billingType: payment.billingType,
          }) } : {}),
        };

        await prisma.charge.upsert({
          where: { cobrancaId: cobranca.id },
          update: {
            externalReference: paymentExternalReference,
            asaasPaymentId: payment.id,
            status: mapAsaasPaymentStatusToCharge(effectivePaymentStatus),
            statusUpdatedAt: new Date(),
            billingType: payment.billingType,
            value: payment.value,
            dueDate: vencimento,
            payerType: payer.type,
            payerId: payer.id,
            ...chargeSnapshot,
          },
          create: {
            id: cobranca.id,
            contaId: input.contaId,
            cobrancaId: cobranca.id,
            externalReference: paymentExternalReference,
            status: mapAsaasPaymentStatusToCharge(effectivePaymentStatus),
            statusUpdatedAt: new Date(),
            asaasPaymentId: payment.id,
            billingType: payment.billingType,
            value: payment.value,
            dueDate: vencimento,
            payerType: payer.type,
            payerId: payer.id,
            ...chargeSnapshot,
          },
          select: { id: true },
        });
      }

      await auditLogService.record({
        contaId: input.contaId,
        actor: input.actor,
        action: 'finance.installmentPlan.payments_synced',
        entity: { type: 'InstallmentPlan', id: updated.id },
        metadata: {
          asaasInstallmentId: updated.asaasInstallmentId,
          paymentsCount: payments.length,
        },
      });
    }

    await auditLogService.record({
      contaId: input.contaId,
      actor: input.actor,
      action: 'finance.installmentPlan.requested',
      entity: { type: 'InstallmentPlan', id: updated.id },
      metadata: {
        externalReference: updated.externalReference,
        contratoId: input.contratoId,
        matriculaId: input.matriculaId,
        installmentCount: input.installmentCount,
        billingType: input.billingType,
        value: input.value,
        firstDueDate: input.firstDueDate,
        description: input.description ?? null,
        discount: input.discount ?? null,
        interest: input.interest ?? null,
        fine: input.fine ?? null,
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
    logFinanceOperationalEvent({
      severity: 'error',
      eventName: 'finance.use_cases.create_installment_plan.failed',
      error: error,
      throttleMs: 60_000,
    });
    return err('ERRO_INTERNO');
  }
}
