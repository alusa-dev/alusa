import { prisma, loadAsaasCredentials } from '@alusa/database';
import { createSubscription as asaasCreateSubscription, type BillingType, type Cycle } from '@alusa/asaas';
import type { SubscriptionStatus } from '@prisma/client';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';
import { resolvePayer } from '@alusa/domain';

import { auditLogService } from '../foundation/audit-log.service';
import { featureFlagsService } from '../foundation/feature-flags.service';
import { requireKycApproved } from '../foundation/kyc-guard';
import { assertAsaasTenantOperational } from '../foundation/asaas-operational-guard';
import { isPastDate } from '../foundation/date-guard';
import { ensureCustomer } from './ensure-customer';
import { mapAsaasSubscriptionStatus } from '../mappers/asaas-subscription-status';
import { deriveDeterministicId, buildSubscriptionExternalReference, buildSafeAsaasIdempotencyKey } from '../core';
import { ensureWebhookConfigOperational } from '../webhooks/ensure-webhook-config-operational';

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
  | 'FEATURE_DISABLED'
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
  | 'END_DATE_ANTES_DA_PRIMEIRA_COBRANCA'
  | 'DATA_INVALIDA'
  | 'ERRO_INTERNO';

export async function createSubscription(
  input: CreateSubscriptionInput
): Promise<Result<CreateSubscriptionOutput, CreateSubscriptionError>> {
  try {
    const enabled = await featureFlagsService.isEnabled(input.contaId, 'enableSubscriptions');
    if (!enabled) return err('FEATURE_DISABLED');

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
        return err('ASSINATURA_CONFLITANTE');
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

    const asaasSubscription = await asaasCreateSubscription({
      apiKey: credentials.apiKey,
      idempotencyKey: safeIdempotencyKey,
      data: asaasPayload,
    }).catch((e: unknown) => {
      const errorInfo = {
        subscriptionId,
        customerId: customerResult.data.customerId,
        billingTypeRequested: input.billingType,
        billingTypeSentToAsaas,
        idempotencyKey: safeIdempotencyKey,
        nextDueDate: input.nextDueDate,
        endDate: input.endDate,
        value: input.value,
        cycle: input.cycle,
        message: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
      };
      console.error('[finance][createSubscription][asaasCreateSubscription] Falha:', errorInfo);
      return null;
    });

    if (!asaasSubscription?.id) return err('ERRO_AO_CRIAR_ASSINATURA');

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
          : await tx.subscription.create({
              data: {
                id: subscriptionId,
                contaId: input.contaId,
                contratoId,
                matriculaId: input.matriculaId,
                externalReference,
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
      throw persistError;
    }

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

    return ok({
      subscriptionId: updated.id,
      externalReference: updated.externalReference,
      asaasSubscriptionId: updated.asaasSubscriptionId ?? null,
      status: updated.status,
      createdAt: updated.createdAt.toISOString(),
      statusUpdatedAt: updated.statusUpdatedAt.toISOString(),
    });
  } catch (error) {
    console.error('[finance][createSubscription]', error);
    return err('ERRO_INTERNO');
  }
}
