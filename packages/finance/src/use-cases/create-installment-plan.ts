import { prisma, loadAsaasCredentials } from '@alusa/database';
import { createInstallment as asaasCreateInstallment, listInstallmentPayments, type BillingType } from '@alusa/asaas';
import type { InstallmentStatus } from '@prisma/client';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';
import { resolvePayer } from '@alusa/domain';
import crypto from 'crypto';

import { auditLogService } from '../foundation/audit-log.service';
import { featureFlagsService } from '../foundation/feature-flags.service';
import { requireKycApproved } from '../foundation/kyc-guard';
import { assertAsaasTenantOperational } from '../foundation/asaas-operational-guard';
import { isPastDate } from '../foundation/date-guard';
import { ensureCustomer } from './ensure-customer';
import { buildInstallmentExternalReference, buildPaymentExternalReference, deriveDeterministicId, toFormaPagamento } from '../core';
import { mapAsaasPaymentStatusToCobrancaStatus } from '../mappers/asaas-payment-status';
import { ensureWebhookConfigOperational } from '../webhooks/ensure-webhook-config-operational';

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
  input: CreateInstallmentPlanInput
): Promise<Result<CreateInstallmentPlanOutput, CreateInstallmentPlanError>> {
  try {
    const enabled = await featureFlagsService.isEnabled(input.contaId, 'enableInstallments');
    if (!enabled) return err('FEATURE_DISABLED');

    const kyc = await requireKycApproved(input.contaId);
    if (!kyc.success) return err(kyc.error === 'KYC_NAO_APROVADO' ? 'KYC_NAO_APROVADO' : 'ERRO_INTERNO');

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
          where: { contaId_matriculaId: { contaId: input.contaId, matriculaId: input.matriculaId } },
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
      if (customerResult.error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS') return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');
      return err('ERRO_AO_CRIAR_CUSTOMER');
    }

    const firstDueDate = new Date(`${input.firstDueDate}T00:00:00.000Z`);
    if (Number.isNaN(firstDueDate.getTime())) return err('DATA_INVALIDA');
    if (isPastDate(input.firstDueDate)) return err('DATA_INVALIDA');

    const isRecreation = existing && (existing.status === 'COMPLETED' || existing.status === 'CANCELED');
    // Retry: plano existe mas criação anterior falhou (sem asaasInstallmentId)
    const isRetry = existing && !existing.asaasInstallmentId && existing.status !== 'ACTIVE';

    const idempotencySeed = `installment:${input.contaId}:${input.contratoId}`;
    const installmentPlanId = existing?.id ?? deriveDeterministicId('ip', idempotencySeed);

    // Gerar novo externalReference quando:
    // 1. Recriação de plano COMPLETED/CANCELED
    // 2. Retry após criação falha (evita conflito de IdempotencyKey com dados diferentes)
    // Usar sufixo curto (8 hex) para garantir unicidade sem estourar limite de 100 chars do Asaas
    const needsNewExternalRef = isRecreation || isRetry;
    const externalReference = needsNewExternalRef
      ? buildInstallmentExternalReference({ installmentPlanId: `${installmentPlanId}:${crypto.randomBytes(4).toString('hex')}` })
      : existing?.externalReference ?? buildInstallmentExternalReference({
          installmentPlanId,
        });

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

    console.log('[finance][createInstallmentPlan] Payload para Asaas:', {
      ...asaasPayload,
      idempotencyKey: externalReference,
    });

    const asaasInstallment = await asaasCreateInstallment({
      apiKey: credentials.apiKey,
      idempotencyKey: externalReference,
      data: asaasPayload,
    }).catch((e) => {
      // Extrair detalhes de erro do Asaas
      const asaasResponse = (e as { responseBody?: unknown })?.responseBody;
      const asaasErrors = (asaasResponse as { errors?: Array<{ code?: string; description?: string }> })?.errors;
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
      console.error('[finance][createInstallmentPlan][asaasCreateInstallment] Falha:', errorInfo);
      return null;
    });

    if (!asaasInstallment?.id) return err('ERRO_AO_CRIAR_PARCELAMENTO');

    // Resetar status para ACTIVE quando recria ou retenta
    const shouldResetStatus = isRecreation || isRetry;

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

    const paymentsResponse = await listInstallmentPayments({
      apiKey: credentials.apiKey,
      installmentId: asaasInstallment.id,
      limit: 100,
      offset: 0,
    }).catch((e) => {
      console.error('[finance][createInstallmentPlan][listInstallmentPayments]', e);
      return null;
    });

    const payments = paymentsResponse?.data ?? [];

    if (payments.length) {
      const sortedPayments = [...payments].sort((a, b) => a.dueDate.localeCompare(b.dueDate));

      for (let index = 0; index < sortedPayments.length; index += 1) {
        const payment = sortedPayments[index];

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
            status: mapAsaasPaymentStatusToCobrancaStatus(payment.status),
            descricao,
            competenciaInicio,
            competenciaFim,
            asaasPaymentId: payment.id,
            asaasStatus: payment.status,
            asaasValue: payment.value,
            asaasNetValue: payment.netValue,
            formaPagamento: toFormaPagamento(payment.billingType ?? input.billingType),
          },
          select: { id: true },
        });

        const paymentExternalReference = buildPaymentExternalReference(
          updated.externalReference,
          payment.id
        );

        await prisma.charge.upsert({
          where: { cobrancaId: cobranca.id },
          update: {
            externalReference: paymentExternalReference,
            asaasPaymentId: payment.id,
            statusUpdatedAt: new Date(),
          },
          create: {
            id: cobranca.id,
            contaId: input.contaId,
            cobrancaId: cobranca.id,
            externalReference: paymentExternalReference,
            status: 'CREATED',
            statusUpdatedAt: new Date(),
            asaasPaymentId: payment.id,
            billingType: payment.billingType,
            value: payment.value,
            dueDate: vencimento,
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
    console.error('[finance][createInstallmentPlan]', error);
    return err('ERRO_INTERNO');
  }
}
