import { prisma, loadAsaasCredentials } from '@alusa/database';
import { createSubscription as asaasCreateSubscription, type BillingType, type Cycle } from '@alusa/asaas';
import type { Prisma, SubscriptionStatus } from '@prisma/client';
import { IntegrationSyncStatus, MatriculaBillingProvisionStatus } from '@prisma/client';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';
import { resolvePayer } from '@alusa/domain';

import { auditLogService } from '../foundation/audit-log.service';
import { requireKycApproved } from '../foundation/kyc-guard';
import { assertAsaasTenantOperational } from '../foundation/asaas-operational-guard';
import { isPastDate } from '../foundation/date-guard';
import { ensureCustomer } from './ensure-customer';
import { mapAsaasSubscriptionStatus } from '../mappers/asaas-subscription-status';
import { deriveDeterministicId, buildSubscriptionExternalReference, buildSafeAsaasIdempotencyKey, hashPayload } from '../core';
import { ensureWebhookConfigOperational } from '../webhooks/ensure-webhook-config-operational';
import { syncSubscriptionFiscalSettings } from './sync-subscription-fiscal-settings';
import { materializeBillingAgreement } from '../billing-agreements/materialize';
import { getSubscription, listSubscriptions } from './asaas-ops';
import {
  markOutboundAwaitingWebhook,
  markOutboundRemoteConfirmed,
  markOutboundRemoteRequested,
  markOutboundResultUnknown,
  reserveOutboundFinancialOperation,
} from './outbound-financial-operation';

export type CreateSubscriptionInput = {
  contaId: string;
  contratoId?: string | null;
  matriculaId: string;
  idempotencyKey?: string;

  value: number;
  nextDueDate: string; // YYYY-MM-DD
  billingType: BillingType;
  cycle: Cycle;
  description?: string;
  endDate?: string; // YYYY-MM-DD
  discount?: {
    value?: number;
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

export type CreateSubscriptionOutput = {
  subscriptionId: string;
  externalReference: string;
  asaasSubscriptionId: string | null;
  status: SubscriptionStatus;
  createdAt: string;
  statusUpdatedAt: string;
};

export type CreateSubscriptionError =
  | 'KYC_NAO_APROVADO'
  | 'MATRICULA_NAO_ENCONTRADA'
  | 'CONTRATO_NAO_ENCONTRADO'
  | 'ASSINATURA_CONFLITANTE'
  | 'FORMA_PAGAMENTO_INVALIDA'
  | 'PAGADOR_NAO_ENCONTRADO'
  | 'PAGADOR_SEM_CPF'
  | 'ASAAS_CUSTOMER_INVALIDO'
  | 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
  | 'ERRO_AO_CRIAR_CUSTOMER'
  | 'ERRO_AO_CRIAR_ASSINATURA'
  | 'ERRO_AO_PERSISTIR_ASSINATURA'
  | 'BILLING_AGREEMENT_MATERIALIZATION_FAILED'
  | 'END_DATE_ANTES_DA_PRIMEIRA_COBRANCA'
  | 'DATA_INVALIDA'
  | 'ERRO_INTERNO';

class BillingAgreementMaterializationError extends Error {
  constructor(readonly _originalError: unknown) {
    super('BILLING_AGREEMENT_MATERIALIZATION_FAILED');
    this.name = 'BillingAgreementMaterializationError';
  }
}

function addBillingCycle(date: string, cycle: Cycle): string {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day!));
  switch (cycle) {
    case 'WEEKLY':
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case 'BIWEEKLY':
      next.setUTCDate(next.getUTCDate() + 14);
      break;
    case 'QUARTERLY':
      next.setUTCMonth(next.getUTCMonth() + 3);
      break;
    case 'BIMONTHLY':
      next.setUTCMonth(next.getUTCMonth() + 2);
      break;
    case 'SEMIANNUALLY':
      next.setUTCMonth(next.getUTCMonth() + 6);
      break;
    case 'YEARLY':
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      break;
    case 'MONTHLY':
    default:
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
  }
  return next.toISOString().slice(0, 10);
}

/**
 * O Asaas pode materializar o primeiro pagamento durante o POST e devolver a
 * assinatura já apontando para o ciclo seguinte. As duas respostas confirmam
 * a mesma intenção; qualquer outra data continua sendo divergência real.
 */
export function isCompatibleSubscriptionNextDueDate(input: {
  requestedNextDueDate: string;
  remoteNextDueDate?: string | null;
  cycle: Cycle;
}) {
  if (input.remoteNextDueDate == null) return true;
  return (
    input.remoteNextDueDate === input.requestedNextDueDate ||
    input.remoteNextDueDate === addBillingCycle(input.requestedNextDueDate, input.cycle)
  );
}

async function materializeIndividualAgreement(
  input: CreateSubscriptionInput,
  subscriptionId: string,
  tx?: Prisma.TransactionClient,
) {
  try {
    const materializeInput = {
      kind: 'INDIVIDUAL',
      contaId: input.contaId,
      subscriptionId,
      actorId: input.actor.id,
      value: input.value,
      billingType: input.billingType,
      cycle: input.cycle,
      nextDueDate: input.nextDueDate,
      validUntil: input.endDate ?? null,
      terms: {
        interestValue: input.interest?.value ?? null,
        interestType: input.interest ? 'PERCENTAGE' : null,
        fineValue: input.fine?.value ?? null,
        fineType: input.fine?.type ?? null,
        discountValue: input.discount?.value ?? null,
        discountType: input.discount?.type ?? null,
        discountDueDateLimitDays: input.discount?.dueDateLimitDays ?? null,
      },
    } as const;

    return tx
      ? await materializeBillingAgreement(materializeInput, { tx })
      : await materializeBillingAgreement(materializeInput);
  } catch (error) {
    throw new BillingAgreementMaterializationError(error);
  }
}

export async function createSubscription(
  input: CreateSubscriptionInput
): Promise<Result<CreateSubscriptionOutput, CreateSubscriptionError>> {
  try {
    const kyc = await requireKycApproved(input.contaId);
    if (!kyc.success) return err(kyc.error === 'KYC_NAO_APROVADO' ? 'KYC_NAO_APROVADO' : 'ERRO_INTERNO');

    try {
      await assertAsaasTenantOperational(input.contaId);
    } catch {
      return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');
    }

    if (!Number.isFinite(input.value) || input.value <= 0) {
      return err('DATA_INVALIDA');
    }

    const matricula = await prisma.matricula.findFirst({
      where: { id: input.matriculaId, aluno: { contaId: input.contaId } },
      select: {
        id: true,
        alunoId: true,
        planoId: true,
        comboId: true,
        responsavelFinanceiroId: true,
        asaasSubscriptionId: true,
        aluno: { select: { id: true, dataNasc: true } },
      },
    });

    if (!matricula) return err('MATRICULA_NAO_ENCONTRADA');

    const contratoId = input.contratoId?.trim() || null;

    if (contratoId) {
      const contrato = await prisma.contrato.findFirst({
        where: { id: contratoId, matriculaId: matricula.id },
        select: { id: true },
      });

      if (!contrato) return err('CONTRATO_NAO_ENCONTRADO');
    }

    const existingByContrato = contratoId
      ? await prisma.subscription.findUnique({
          where: { contaId_contratoId: { contaId: input.contaId, contratoId } },
          select: {
            id: true,
            contratoId: true,
            matriculaId: true,
            externalReference: true,
            asaasSubscriptionId: true,
            status: true,
            createdAt: true,
            statusUpdatedAt: true,
          },
        })
      : null;

    const existingByMatricula = existingByContrato
      ? null
      : await prisma.subscription.findUnique({
          where: { contaId_matriculaId: { contaId: input.contaId, matriculaId: input.matriculaId } },
          select: {
            id: true,
            contratoId: true,
            matriculaId: true,
            externalReference: true,
            asaasSubscriptionId: true,
            status: true,
            createdAt: true,
            statusUpdatedAt: true,
          },
        });

    const existing = existingByContrato ?? existingByMatricula;

    if (existing) {
      if (existing.matriculaId !== input.matriculaId) {
        return err('ASSINATURA_CONFLITANTE');
      }

      if (contratoId && existing.contratoId && existing.contratoId !== contratoId) {
        return err('ASSINATURA_CONFLITANTE');
      }

      if (existing.asaasSubscriptionId) {
        await materializeIndividualAgreement(input, existing.id);
        return ok({
          subscriptionId: existing.id,
          externalReference: existing.externalReference,
          asaasSubscriptionId: existing.asaasSubscriptionId,
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
      if (customerResult.error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS') return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');
      return err('ERRO_AO_CRIAR_CUSTOMER');
    }

    if (isPastDate(input.nextDueDate)) {
      return err('DATA_INVALIDA');
    }

    // Validar endDate >= nextDueDate (Asaas rejeita quando endDate é antes da primeira cobrança)
    if (input.endDate) {
      const nextDue = new Date(input.nextDueDate);
      const end = new Date(input.endDate);
      if (end < nextDue) {
        console.warn(
          '[finance][createSubscription] endDate antes de nextDueDate',
          { nextDueDate: input.nextDueDate, endDate: input.endDate, subscriptionId: existing?.id ?? 'new' }
        );
        return err('END_DATE_ANTES_DA_PRIMEIRA_COBRANCA');
      }
    }

    const idempotencySeed = `subscription:${input.contaId}:${input.matriculaId}`;
    const subscriptionId = existing?.id ?? deriveDeterministicId('sub', idempotencySeed);
    const referencePlanId =
      matricula.comboId ??
      matricula.planoId ??
      contratoId ??
      input.matriculaId;
    const externalReference = existing?.externalReference ?? buildSubscriptionExternalReference({
      matriculaId: input.matriculaId,
      planoId: referencePlanId,
    });

    await ensureWebhookConfigOperational(input.contaId);

    const credentials = await loadAsaasCredentials(input.contaId);
    if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

    const billingTypeSentToAsaas: BillingType = input.billingType;

    // Asaas limita Idempotency-Key a 47 chars; externalReference excede com CUIDs.
    const safeIdempotencyKey = buildSafeAsaasIdempotencyKey(
      input.idempotencyKey ?? externalReference,
    );

    const asaasPayload = {
      customer: customerResult.data.customerId,
      billingType: billingTypeSentToAsaas,
      nextDueDate: input.nextDueDate,
      value: input.value,
      cycle: input.cycle,
      description: input.description,
      endDate: input.endDate,
      externalReference,
      ...(input.discount ? { discount: input.discount } : {}),
      ...(input.interest ? { interest: input.interest } : {}),
      ...(input.fine ? { fine: input.fine } : {}),
    };

    // A intenção local e o ledger precisam existir antes do POST. Assim, timeout
    // ou queda entre Asaas e banco nunca autorizam uma segunda assinatura às cegas.
    if (!existing) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.subscription.create({
            data: {
              id: subscriptionId,
              contaId: input.contaId,
              contratoId,
              matriculaId: input.matriculaId,
              externalReference,
              status: 'REQUESTED',
              statusUpdatedAt: new Date(),
            },
          });
          await materializeIndividualAgreement(input, subscriptionId, tx);
        });
      } catch (reserveError) {
        const concurrent = await prisma.subscription.findFirst({
          where: { contaId: input.contaId, id: subscriptionId, externalReference },
          select: { id: true },
        });
        if (!concurrent) throw reserveError;
      }
    } else {
      await materializeIndividualAgreement(input, existing.id);
    }

    const requestFingerprint = hashPayload(asaasPayload);
    const operation = await reserveOutboundFinancialOperation({
      contaId: input.contaId,
      type: 'CREATE_SUBSCRIPTION',
      idempotencyKey: safeIdempotencyKey,
      resource: 'SUBSCRIPTION',
      entityId: subscriptionId,
      externalReference,
      requestFingerprint,
      links: { subscriptionId },
      metadata: { matriculaId: input.matriculaId, contratoId },
    });

    let asaasSubscription = null as Awaited<ReturnType<typeof getSubscription>> | null;
    if (operation.payload.remoteId) {
      asaasSubscription = await getSubscription(operation.payload.remoteId, { contaId: input.contaId }).catch(() => null);
    }
    if (!asaasSubscription) {
      const matches = await listSubscriptions(
        { externalReference, limit: 10, includeDeleted: true },
        { contaId: input.contaId },
      ).then((result) => result.data).catch(() => []);
      if (matches.length > 1) {
        await markOutboundResultUnknown({
          jobId: operation.job.id,
          contaId: input.contaId,
          resource: 'SUBSCRIPTION',
          entityId: subscriptionId,
          externalReference,
          error: 'MULTIPLE_REMOTE_SUBSCRIPTIONS_FOR_EXTERNAL_REFERENCE',
        });
        return err('ERRO_AO_CRIAR_ASSINATURA');
      }
      asaasSubscription = matches[0] ?? null;
    }

    if (!asaasSubscription) {
      const claimed = await markOutboundRemoteRequested(operation.job.id);
      if (!claimed) return err('ERRO_AO_CRIAR_ASSINATURA');
      try {
        const created = await asaasCreateSubscription({
          apiKey: credentials.apiKey,
          idempotencyKey: safeIdempotencyKey,
          data: asaasPayload,
        });
        asaasSubscription = await getSubscription(created.id, { contaId: input.contaId });
      } catch (remoteError) {
        const recovered = await listSubscriptions(
          { externalReference, limit: 10, includeDeleted: true },
          { contaId: input.contaId },
        ).then((result) => result.data).catch(() => []);
        if (recovered.length === 1) {
          asaasSubscription = await getSubscription(recovered[0]!.id, { contaId: input.contaId }).catch(() => recovered[0]!);
        } else {
          await markOutboundResultUnknown({
            jobId: operation.job.id,
            contaId: input.contaId,
            resource: 'SUBSCRIPTION',
            entityId: subscriptionId,
            externalReference,
            error: remoteError,
          });
          return err('ERRO_AO_CRIAR_ASSINATURA');
        }
      }
    }

    const subscriptionMismatch = !asaasSubscription?.id
      || asaasSubscription.externalReference !== externalReference
      || (asaasSubscription.customer != null && asaasSubscription.customer !== customerResult.data.customerId)
      || (asaasSubscription.value != null && Math.abs(asaasSubscription.value - input.value) > 0.001)
      || !isCompatibleSubscriptionNextDueDate({
        requestedNextDueDate: input.nextDueDate,
        remoteNextDueDate: asaasSubscription.nextDueDate,
        cycle: input.cycle,
      });
    if (subscriptionMismatch) {
      await markOutboundResultUnknown({
        jobId: operation.job.id,
        contaId: input.contaId,
        resource: 'SUBSCRIPTION',
        entityId: subscriptionId,
        externalReference,
        error: 'REMOTE_SUBSCRIPTION_CONFIRMATION_MISMATCH',
      });
      return err('ERRO_AO_CRIAR_ASSINATURA');
    }
    await markOutboundRemoteConfirmed(operation.job.id, asaasSubscription.id, {
      providerStatus: asaasSubscription.status,
    });

    const nextStatus = mapAsaasSubscriptionStatus({ status: asaasSubscription.status, deleted: asaasSubscription.deleted });

    let updated: {
      id: string;
      externalReference: string;
      asaasSubscriptionId: string | null;
      status: SubscriptionStatus;
      createdAt: Date;
      statusUpdatedAt: Date;
    };

    try {
      updated = await prisma.$transaction(async (tx) => {
        const persisted = existing
          ? await tx.subscription.update({
              where: { id: existing.id },
              data: {
                externalReference,
                asaasSubscriptionId: asaasSubscription.id,
                status: nextStatus,
                statusUpdatedAt: new Date(),
                contratoId: contratoId ?? existing.contratoId ?? null,
                matriculaId: input.matriculaId,
              },
              select: {
                id: true,
                externalReference: true,
                asaasSubscriptionId: true,
                status: true,
                createdAt: true,
                statusUpdatedAt: true,
              },
            })
          : await tx.subscription.update({
              where: { id: subscriptionId },
              data: {
                contratoId,
                asaasSubscriptionId: asaasSubscription.id,
                status: nextStatus,
                statusUpdatedAt: new Date(),
              },
              select: {
                id: true,
                externalReference: true,
                asaasSubscriptionId: true,
                status: true,
                createdAt: true,
                statusUpdatedAt: true,
              },
            });

        if (!matricula.asaasSubscriptionId) {
          await tx.matricula.update({
            where: { id: matricula.id },
            data: { asaasSubscriptionId: asaasSubscription.id },
          });
        }

        return persisted;
      });
    } catch (persistError) {
      if (
        persistError &&
        typeof persistError === 'object' &&
        'code' in persistError &&
        (persistError as { code?: string }).code === 'P2002'
      ) {
        return err('ASSINATURA_CONFLITANTE');
      }

      const materializationFailed =
        persistError instanceof BillingAgreementMaterializationError;
      const failureCode = materializationFailed
        ? 'BILLING_AGREEMENT_MATERIALIZATION_FAILED'
        : 'PERSISTENCIA_LOCAL_FALHOU';

      console.error('[finance][createSubscription][persist] Falha após Asaas OK', {
        matriculaId: matricula.id,
        asaasSubscriptionId: asaasSubscription.id,
        code: failureCode,
        message: persistError instanceof Error ? persistError.message : String(persistError),
        cause:
          materializationFailed && persistError._originalError instanceof Error
            ? persistError._originalError.message
            : undefined,
      });

      await prisma.matricula
        .update({
          where: { id: matricula.id },
          data: {
            pendingAsaasSubscriptionId: asaasSubscription.id,
            integrationStatus: IntegrationSyncStatus.PENDENTE_SINCRONISMO,
            billingProvisionStatus: MatriculaBillingProvisionStatus.PARCIAL,
            billingProvisionError: failureCode,
            billingProvisionAt: new Date(),
          },
        })
        .catch((compensationError) => {
          console.error('[finance][createSubscription][compensation] Falha ao registrar pendência', {
            matriculaId: matricula.id,
            message:
              compensationError instanceof Error
                ? compensationError.message
                : String(compensationError),
          });
        });

      return err(
        materializationFailed
          ? 'BILLING_AGREEMENT_MATERIALIZATION_FAILED'
          : 'ERRO_AO_PERSISTIR_ASSINATURA',
      );
    }

    await markOutboundAwaitingWebhook(operation.job.id, asaasSubscription.id);

    await auditLogService.record({
      contaId: input.contaId,
      actor: input.actor,
      action: 'finance.subscription.requested',
      entity: { type: 'Subscription', id: updated.id },
      metadata: {
        externalReference: updated.externalReference,
        contratoId,
        matriculaId: input.matriculaId,
        value: input.value,
        billingTypeRequested: input.billingType,
        billingTypeSentToAsaas,
        cycle: input.cycle,
        nextDueDate: input.nextDueDate,
        endDate: input.endDate ?? null,
        discount: input.discount ?? null,
        interest: input.interest ?? null,
        fine: input.fine ?? null,
      },
    });

    if (updated.asaasSubscriptionId) {
      const fiscalSync = await syncSubscriptionFiscalSettings({
        contaId: input.contaId,
        subscriptionId: updated.id,
        asaasSubscriptionId: updated.asaasSubscriptionId,
        kind: 'ACADEMIC',
        actor: input.actor,
      });

      if (!fiscalSync.success) {
        console.warn('[finance][createSubscription] falha ao sincronizar invoiceSettings', {
          contaId: input.contaId,
          subscriptionId: updated.id,
          asaasSubscriptionId: updated.asaasSubscriptionId,
          error: fiscalSync.error,
        });
      }
    }

    return ok({
      subscriptionId: updated.id,
      externalReference: updated.externalReference,
      asaasSubscriptionId: updated.asaasSubscriptionId ?? null,
      status: updated.status,
      createdAt: updated.createdAt.toISOString(),
      statusUpdatedAt: updated.statusUpdatedAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof BillingAgreementMaterializationError) {
      console.error('[finance][createSubscription][billingAgreement]', {
        contaId: input.contaId,
        matriculaId: input.matriculaId,
        code: error.message,
        message:
          error._originalError instanceof Error
            ? error._originalError.message
            : String(error._originalError),
      });
      return err('BILLING_AGREEMENT_MATERIALIZATION_FAILED');
    }
    console.error('[finance][createSubscription]', error);
    return err('ERRO_INTERNO');
  }
}
