import { prisma, loadAsaasCredentials } from '@alusa/database';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';
import { type BillingType, createSubscription } from '@alusa/asaas';
import { resolvePayer } from '@alusa/domain';
import crypto from 'crypto';

import { createAsaasPayment } from './create-payment';
import { ensureCustomer } from './ensure-customer';
import { listPayments } from './asaas-ops';
import { syncPaymentStateFromAsaas } from './sync-payment-state-from-asaas';
import { createStandaloneInstallmentPlan } from './create-standalone-installment-plan';
import { auditLogService } from '../foundation/audit-log.service';
import { requireKycApproved } from '../foundation/kyc-guard';
import { isPastDate } from '../foundation/date-guard';
import {
  createStandaloneSubscriptionRecord,
  findStandaloneSubscription,
} from '../foundation/standalone-subscription-store';
import {
  buildStandaloneExternalReference,
  deriveDeterministicId,
  isPrismaUniqueViolation,
  withIdempotencyGuard,
} from '../core';
import { mapAsaasSubscriptionStatus } from '../mappers/asaas-subscription-status';
import type { CustomerPayerType } from '@prisma/client';
import type {
  NotificationChannelPreferences,
  NotificationWarning,
} from '../services/customer-notification.service';
import { chargeReadModelService } from '../read-model/charge-read-model.service';

async function materializeFirstSubscriptionPayment(params: {
  contaId: string;
  subscriptionId: string;
  expectedDueDate?: string;
}) {
  try {
    const payments = await listPayments(
      {
        subscription: params.subscriptionId,
        limit: 10,
        offset: 0,
      },
      { contaId: params.contaId },
    );

    const candidate =
      payments.data.find((payment) => payment.dueDate === params.expectedDueDate) ??
      payments.data.find((payment) => payment.status === 'PENDING') ??
      payments.data[0];

    if (!candidate?.id) {
      console.info('[createStandaloneCharge] Assinatura criada sem payment listável imediatamente', {
        contaId: params.contaId,
        asaasSubscriptionId: params.subscriptionId,
      });
      return;
    }

    const syncResult = await syncPaymentStateFromAsaas({
      contaId: params.contaId,
      asaasPaymentId: candidate.id,
    });

    if (!syncResult.success) {
      console.warn('[createStandaloneCharge] Falha ao materializar payment inicial da assinatura', {
        contaId: params.contaId,
        asaasSubscriptionId: params.subscriptionId,
        asaasPaymentId: candidate.id,
        error: syncResult.error,
      });
    }
  } catch (error) {
    console.warn('[createStandaloneCharge] Não foi possível consultar payments iniciais da assinatura', {
      contaId: params.contaId,
      asaasSubscriptionId: params.subscriptionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// =============================================================================
// Types
// =============================================================================

export type ChargeType = 'ONE_TIME' | 'INSTALLMENT' | 'SUBSCRIPTION';

export type CreateStandaloneChargeInput = {
  contaId: string;
  actor: { type: 'USER' | 'SYSTEM'; id?: string };

  /** Pagador: pode ser por customerId local ou alunoId */
  payer:
    | { type: 'customer'; customerId: string }
    | { type: 'aluno'; alunoId: string }
    | { type: 'responsavel'; responsavelId: string };

  /** Tipo de cobrança */
  chargeType: ChargeType;

  /** Forma de pagamento */
  billingType: BillingType;

  /** Descrição (recomendado) */
  description?: string;

  // ONE_TIME
  value?: number;
  dueDate?: string; // ISO date

  // INSTALLMENT
  installmentCount?: number;
  installmentValue?: number;

  // SUBSCRIPTION
  nextDueDate?: string;
  endDate?: string;
  cycle?: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'BIMONTHLY' | 'QUARTERLY' | 'SEMIANNUALLY' | 'YEARLY';

  // Opcionais
  discount?: {
    value: number;
    type: 'FIXED' | 'PERCENTAGE';
    dueDateLimitDays?: number;
  };
  interest?: {
    value: number; // % ao mês
  };
  fine?: {
    value: number;
    type: 'FIXED' | 'PERCENTAGE';
  };

  /** Canais de notificação para habilitar no cliente (EMAIL, SMS, WHATSAPP) */
  notificationChannels?: string[];
  notificationChannelsConfigured?: boolean;

  /** Chave de idempotência opcional do cliente */
  uiRequestId?: string;
};

export type CreateStandaloneChargeOutput = {
  chargeId: string;
  asaasPaymentId?: string;
  asaasSubscriptionId?: string;
  externalReference: string;
  status: string;
  expectedWebhooks?: string[];
  notificationSync?: {
    applied: NotificationChannelPreferences;
    warnings: NotificationWarning[];
  };
};

export type CreateStandaloneChargeError =
  | 'FEATURE_DISABLED'
  | 'KYC_NAO_APROVADO'
  | 'PAGADOR_NAO_ENCONTRADO'
  | 'PAGADOR_SEM_CPF'
  | 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
  | 'CUSTOMER_SEM_ASAAS_ID'
  | 'MATRICULA_NAO_ENCONTRADA'
  | 'FORMA_PAGAMENTO_INVALIDA'
  | 'VALOR_INVALIDO'
  | 'DATA_INVALIDA'
  | 'PARCELAS_INVALIDAS'
  | 'CICLO_OBRIGATORIO'
  | 'ERRO_AO_CRIAR_PAGAMENTO'
  | 'COBRANCA_DUPLICADA'
  | 'SUBSCRIPTION_DUPLICADA'
  | 'RESPONSAVEL_OBRIGATORIO_MENOR'
  | 'ERRO_INTERNO';

type ResolvedStandaloneChargePayer = {
  payerType: CustomerPayerType;
  payerId: string;
  displayName: string;
  financialPayerName: string;
};

// =============================================================================
// Helpers
// =============================================================================

function computeIdempotencyKey(input: CreateStandaloneChargeInput): string {
  const payerKey =
    input.payer.type === 'customer'
      ? `cust:${input.payer.customerId}`
      : input.payer.type === 'aluno'
        ? `aluno:${input.payer.alunoId}`
        : `resp:${input.payer.responsavelId}`;

  const valueKey =
    input.chargeType === 'INSTALLMENT'
      ? `${input.installmentCount}x${input.installmentValue}`
      : `${input.value}`;

  const dateKey =
    input.chargeType === 'SUBSCRIPTION' ? (input.nextDueDate ?? '') : (input.dueDate ?? '');

  const cycleKey = input.chargeType === 'SUBSCRIPTION' ? (input.cycle ?? '') : '';
  const endDateKey = input.chargeType === 'SUBSCRIPTION' ? (input.endDate ?? '') : '';

  const raw = [
    input.contaId,
    payerKey,
    input.chargeType,
    input.billingType,
    valueKey,
    dateKey,
    cycleKey,
    endDateKey,
  ].join('|');

  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

function buildStandaloneSubscriptionExternalReference(subscriptionId: string): string {
  return `alusa:standalone-subscription:${subscriptionId}`;
}

const allowedBillingTypesByChargeType: Record<ChargeType, ReadonlyArray<BillingType>> = {
  ONE_TIME: ['BOLETO', 'PIX', 'CREDIT_CARD', 'UNDEFINED'],
  INSTALLMENT: ['BOLETO', 'CREDIT_CARD'],
  SUBSCRIPTION: ['BOLETO', 'PIX', 'CREDIT_CARD', 'UNDEFINED'],
};

async function resolveStandaloneChargePayer(
  input: CreateStandaloneChargeInput,
): Promise<Result<ResolvedStandaloneChargePayer, CreateStandaloneChargeError>> {
  if (input.payer.type === 'customer') {
    const customer = await prisma.customer.findFirst({
      where: { id: input.payer.customerId, contaId: input.contaId },
      select: { payerType: true, payerId: true, asaasCustomerId: true },
    });

    if (!customer) return err('PAGADOR_NAO_ENCONTRADO');
    if (!customer.asaasCustomerId) return err('CUSTOMER_SEM_ASAAS_ID');

    if (customer.payerType === 'ALUNO') {
      const aluno = await prisma.aluno.findFirst({
        where: { id: customer.payerId, contaId: input.contaId },
        select: { nome: true },
      });

      const name = aluno?.nome ?? 'Cliente';
      return ok({
        payerType: customer.payerType,
        payerId: customer.payerId,
        displayName: name,
        financialPayerName: name,
      });
    }

    const responsavel = await prisma.responsavel.findFirst({
      where: { id: customer.payerId, contaId: input.contaId },
      select: { nome: true },
    });

    const name = responsavel?.nome ?? 'Cliente';
    return ok({
      payerType: customer.payerType,
      payerId: customer.payerId,
      displayName: name,
      financialPayerName: name,
    });
  }

  if (input.payer.type === 'aluno') {
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

    if (!aluno) return err('PAGADOR_NAO_ENCONTRADO');

    const resolved = resolvePayer({
      alunoId: aluno.id,
      alunoDataNasc: aluno.dataNasc,
      responsavelFinanceiroId: aluno.responsaveis[0]?.responsavelId ?? null,
    });

    if (!resolved.success) {
      if (resolved.error === 'RESPONSAVEL_OBRIGATORIO_MENOR') {
        return err('RESPONSAVEL_OBRIGATORIO_MENOR');
      }
      return err('PAGADOR_NAO_ENCONTRADO');
    }

    if (resolved.payer.type === 'ALUNO') {
      return ok({
        payerType: 'ALUNO',
        payerId: resolved.payer.id,
        displayName: aluno.nome,
        financialPayerName: aluno.nome,
      });
    }

    const responsavel = await prisma.responsavel.findFirst({
      where: { id: resolved.payer.id, contaId: input.contaId },
      select: { nome: true },
    });

    return ok({
      payerType: 'RESPONSAVEL',
      payerId: resolved.payer.id,
      displayName: aluno.nome,
      financialPayerName: responsavel?.nome ?? aluno.nome,
    });
  }

  const responsavel = await prisma.responsavel.findFirst({
    where: { id: input.payer.responsavelId, contaId: input.contaId },
    select: { id: true, nome: true },
  });

  if (!responsavel) return err('PAGADOR_NAO_ENCONTRADO');

  return ok({
    payerType: 'RESPONSAVEL',
    payerId: responsavel.id,
    displayName: responsavel.nome,
    financialPayerName: responsavel.nome,
  });
}

// =============================================================================
// Main Use Case
// =============================================================================

export async function createStandaloneCharge(
  input: CreateStandaloneChargeInput,
): Promise<Result<CreateStandaloneChargeOutput, CreateStandaloneChargeError>> {
  try {
    // 1. Validar KYC
    const kyc = await requireKycApproved(input.contaId);
    if (!kyc.success) return err('KYC_NAO_APROVADO');

    const allowedBillingTypes = allowedBillingTypesByChargeType[input.chargeType] ?? [];
    if (!allowedBillingTypes.includes(input.billingType)) {
      return err('FORMA_PAGAMENTO_INVALIDA');
    }

    // 2. Validações de entrada
    if (input.chargeType === 'ONE_TIME') {
      if (!input.value || input.value <= 0) return err('VALOR_INVALIDO');
      if (!input.dueDate) return err('DATA_INVALIDA');
      if (isPastDate(input.dueDate)) return err('DATA_INVALIDA');
    }

    if (input.chargeType === 'INSTALLMENT') {
      if (!input.installmentCount || input.installmentCount < 2) return err('PARCELAS_INVALIDAS');
      if (!input.installmentValue || input.installmentValue <= 0) return err('VALOR_INVALIDO');
      if (!input.dueDate) return err('DATA_INVALIDA');
      if (isPastDate(input.dueDate)) return err('DATA_INVALIDA');
    }

    if (input.chargeType === 'SUBSCRIPTION') {
      if (!input.value || input.value <= 0) return err('VALOR_INVALIDO');
      if (!input.nextDueDate) return err('DATA_INVALIDA');
      if (!input.endDate) return err('DATA_INVALIDA');
      if (!input.cycle) return err('CICLO_OBRIGATORIO');
      if (isPastDate(input.nextDueDate)) return err('DATA_INVALIDA');
      if (input.endDate) {
        const nextDue = new Date(input.nextDueDate);
        const end = new Date(input.endDate);
        if (end < nextDue) return err('DATA_INVALIDA');
      }
    }

    // 3. Computar idempotencyKey + IDs determinísticos
    const idempotencyKey = input.uiRequestId ?? computeIdempotencyKey(input);
    const chargeId = deriveDeterministicId('ch', idempotencyKey);
    const externalReference = buildStandaloneExternalReference({ chargeId });

    if (input.chargeType === 'ONE_TIME') {
      // 4. Verificar duplicidade (idempotência local) - Suporta V1 e V2
      const existingCharge = await prisma.charge.findFirst({
        where: {
          contaId: input.contaId,
          OR: [
            { externalReference },
            { externalReference: { startsWith: `standalone:${idempotencyKey}` } },
          ],
          status: { notIn: ['CANCELED', 'REFUNDED'] },
        },
        select: {
          id: true,
          asaasPaymentId: true,
          externalReference: true,
          status: true,
        },
      });

      if (existingCharge) {
        if (existingCharge.asaasPaymentId) {
          return ok({
            chargeId: existingCharge.id,
            asaasPaymentId: existingCharge.asaasPaymentId ?? undefined,
            externalReference: existingCharge.externalReference,
            status: existingCharge.status ?? 'OPEN',
          });
        }
        return err('COBRANCA_DUPLICADA');
      }
    }

    // 5. Resolver pagador financeiro e nome exibido na UI
    const resolvedPayer = await resolveStandaloneChargePayer(input);
    if (!resolvedPayer.success) return err(resolvedPayer.error);

    const { payerType, payerId, displayName, financialPayerName } = resolvedPayer.data;

    // 6. Garantir customer no Asaas
    const customerResult = await ensureCustomer({
      contaId: input.contaId,
      payer: { type: payerType, id: payerId },
    });

    if (!customerResult.success) {
      if (customerResult.error === 'PAGADOR_NAO_ENCONTRADO') return err('PAGADOR_NAO_ENCONTRADO');
      if (customerResult.error === 'PAGADOR_SEM_CPF') return err('PAGADOR_SEM_CPF');
      if (customerResult.error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS')
        return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');
      return err('PAGADOR_NAO_ENCONTRADO');
    }

    const asaasCustomerId = customerResult.data.customerId;

    let notificationSync:
      | { applied: NotificationChannelPreferences; warnings: NotificationWarning[] }
      | undefined;

    if (input.notificationChannelsConfigured) {
      try {
        const { syncCustomerNotificationChannels } =
          await import('../services/customer-notification.service');
        const configuredChannels = input.notificationChannels ?? [];
        const syncResult = await syncCustomerNotificationChannels(input.contaId, asaasCustomerId, {
          email: configuredChannels.includes('EMAIL'),
          sms: configuredChannels.includes('SMS'),
          whatsapp: configuredChannels.includes('WHATSAPP'),
        });

        notificationSync = {
          applied: syncResult.applied,
          warnings: syncResult.warnings,
        };

        if (syncResult.warnings.length > 0) {
          console.warn('[createStandaloneCharge] Notificações parcialmente configuradas', {
            customerId: asaasCustomerId,
            applied: syncResult.applied,
            warningsCount: syncResult.warnings.length,
            warnings: syncResult.warnings.map((w) => ({
              event: w.event,
              channel: w.channel,
              code: w.code,
            })),
          });
        }
      } catch (syncError) {
        console.warn('[createStandaloneCharge] Falha ao sincronizar notificações (não crítico)', {
          customerId: asaasCustomerId,
          error: syncError instanceof Error ? syncError.message : String(syncError),
        });
      }
    }

    // 8. Chamar Asaas conforme tipo e persistir local somente após OK
    if (input.chargeType === 'ONE_TIME') {
      const vencimentoDate = new Date(`${input.dueDate}T00:00:00`);
      const paymentInput = {
        contaId: input.contaId,
        customer: asaasCustomerId,
        billingType: input.billingType,
        value: input.value!,
        dueDate: input.dueDate!,
        description: input.description,
        externalReference,
        idempotencyKey,
        discount: input.discount,
        interest: input.interest,
        fine: input.fine,
      };

      const payment = await createAsaasPayment(paymentInput);
      if (!payment.success) {
        if (payment.error === 'Credenciais Asaas não configuradas')
          return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');
        return err('ERRO_AO_CRIAR_PAGAMENTO');
      }

      const persistedCharge = await withIdempotencyGuard({
        contaId: input.contaId,
        scope: 'charge-create',
        key: idempotencyKey,
        fn: async (tx) => {
          const existingByIdempotency = await tx.charge.findFirst({
            where: {
              contaId: input.contaId,
              OR: [{ externalReference }, { asaasPaymentId: payment.data.id }],
            },
            select: { id: true, status: true, asaasPaymentId: true },
          });

          if (existingByIdempotency) return existingByIdempotency;

          try {
            return await tx.charge.create({
              data: {
                id: chargeId,
                contaId: input.contaId,
                externalReference,
                status: 'OPEN',
                statusUpdatedAt: new Date(),
                asaasPaymentId: payment.data.id,
                payerName: displayName,
                description: input.description ?? 'Cobrança avulsa',
                value: input.value!,
                dueDate: vencimentoDate,
                billingType: input.billingType,
                customerId: customerResult.data.localCustomerId,
                invoiceUrl: payment.data.invoiceUrl ?? null,
              },
              select: { id: true, status: true, asaasPaymentId: true },
            });
          } catch (createError) {
            if (isPrismaUniqueViolation(createError)) {
              const existingAfterConflict = await tx.charge.findFirst({
                where: {
                  contaId: input.contaId,
                  OR: [{ externalReference }, { asaasPaymentId: payment.data.id }],
                },
                select: { id: true, status: true, asaasPaymentId: true },
              });
              if (existingAfterConflict) return existingAfterConflict;
            }
            throw createError;
          }
        },
      });

      await chargeReadModelService.projectChargeReadModelByChargeId(persistedCharge.id);

      await auditLogService.record({
        contaId: input.contaId,
        actor: input.actor,
        action: 'finance.standalone_charge.created',
        entity: { type: 'Charge', id: persistedCharge.id },
        metadata: {
          chargeType: input.chargeType,
          asaasPaymentId: payment.data.id,
          externalReference,
          payerType,
          payerId,
          payerName: financialPayerName,
          displayName,
        },
      });

      return ok({
        chargeId: persistedCharge.id,
        asaasPaymentId: payment.data.id,
        externalReference,
        status: persistedCharge.status ?? 'OPEN',
        notificationSync,
      });
    }

    if (input.chargeType === 'INSTALLMENT') {
      const totalInstallmentValue = Number(
        (input.installmentValue! * input.installmentCount!).toFixed(2),
      );

      const installmentResult = await createStandaloneInstallmentPlan({
        contaId: input.contaId,
        payer:
          input.payer.type === 'aluno'
            ? { type: 'aluno', alunoId: input.payer.alunoId }
            : {
                type: 'responsavel',
                responsavelId:
                  input.payer.type === 'responsavel' ? input.payer.responsavelId : payerId,
              },
        installmentCount: input.installmentCount!,
        billingType: input.billingType,
        value: totalInstallmentValue,
        firstDueDate: input.dueDate!,
        description: input.description,
        discount: input.discount,
        interest: input.interest,
        fine: input.fine,
        uiRequestId: input.uiRequestId ?? idempotencyKey,
        actor: input.actor,
      });

      if (!installmentResult.success) {
        if (installmentResult.error === 'FEATURE_DISABLED') return err('FEATURE_DISABLED');
        if (installmentResult.error === 'KYC_NAO_APROVADO') return err('KYC_NAO_APROVADO');
        if (installmentResult.error === 'PAGADOR_NAO_ENCONTRADO')
          return err('PAGADOR_NAO_ENCONTRADO');
        if (installmentResult.error === 'CUSTOMER_SEM_ASAAS_ID')
          return err('CUSTOMER_SEM_ASAAS_ID');
        if (installmentResult.error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS')
          return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');
        if (installmentResult.error === 'FORMA_PAGAMENTO_INVALIDA')
          return err('FORMA_PAGAMENTO_INVALIDA');
        if (installmentResult.error === 'VALOR_INVALIDO') return err('VALOR_INVALIDO');
        if (installmentResult.error === 'DATA_INVALIDA') return err('DATA_INVALIDA');
        if (installmentResult.error === 'PARCELAS_INVALIDAS') return err('PARCELAS_INVALIDAS');
        if (installmentResult.error === 'ERRO_AO_CRIAR_PARCELAMENTO')
          return err('ERRO_AO_CRIAR_PAGAMENTO');
        return err('ERRO_INTERNO');
      }

      return ok({
        chargeId: installmentResult.data.installmentPlanId,
        externalReference: installmentResult.data.externalReference,
        status: installmentResult.data.status,
        notificationSync,
      });
    }

    if (input.chargeType === 'SUBSCRIPTION') {
      const subscriptionId = deriveDeterministicId('sub', idempotencyKey);
      const subscriptionExternalReference =
        buildStandaloneSubscriptionExternalReference(subscriptionId);

      // Verificar duplicidade local
      const existingSubscription = await findStandaloneSubscription(prisma, {
        contaId: input.contaId,
        externalReference: subscriptionExternalReference,
        idempotencyKey,
      });

      if (existingSubscription) {
        return ok({
          chargeId: existingSubscription.id,
          asaasSubscriptionId: existingSubscription.asaasSubscriptionId ?? undefined,
          externalReference: existingSubscription.externalReference,
          status: existingSubscription.status,
          expectedWebhooks: [],
          notificationSync,
        });
      }

      const creds = await loadAsaasCredentials(input.contaId);
      if (!creds) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

      const subscription = await createSubscription({
        apiKey: creds.apiKey,
        idempotencyKey,
        data: {
          customer: asaasCustomerId,
          billingType: input.billingType,
          value: input.value!,
          nextDueDate: input.nextDueDate!,
          cycle: input.cycle!,
          endDate: input.endDate,
          description: input.description,
          externalReference: subscriptionExternalReference,
          discount: input.discount,
          interest: input.interest,
          fine: input.fine,
        },
      });

      const nextStatus = mapAsaasSubscriptionStatus({
        status: subscription.status,
        deleted: subscription.deleted,
      });

      const nextDueDateParsed = new Date(`${input.nextDueDate}T00:00:00`);
      const endDateParsed = input.endDate ? new Date(`${input.endDate}T00:00:00`) : null;

      const persisted = await withIdempotencyGuard({
        contaId: input.contaId,
        scope: 'subscription-create',
        key: idempotencyKey,
        fn: async (tx) => {
          const existingByIdempotency = await findStandaloneSubscription(tx as typeof prisma, {
            contaId: input.contaId,
            externalReference: subscriptionExternalReference,
            asaasSubscriptionId: subscription.id,
          });

          if (existingByIdempotency) return existingByIdempotency;

          try {
            return await createStandaloneSubscriptionRecord(tx as typeof prisma, {
              id: subscriptionId,
              contaId: input.contaId,
              customerId: customerResult.data.localCustomerId,
              externalReference: subscriptionExternalReference,
              idempotencyKey,
              status: nextStatus,
              asaasSubscriptionId: subscription.id,
              cycle: input.cycle!,
              billingType: input.billingType,
              value: input.value!,
              nextDueDate: nextDueDateParsed,
              endDate: endDateParsed,
              description: input.description,
            });
          } catch (createError) {
            if (
              isPrismaUniqueViolation(createError) ||
              (createError &&
                typeof createError === 'object' &&
                'code' in createError &&
                (createError as { code?: string }).code === '23505')
            ) {
              const existingAfterConflict = await findStandaloneSubscription(tx as typeof prisma, {
                contaId: input.contaId,
                externalReference: subscriptionExternalReference,
                asaasSubscriptionId: subscription.id,
              });
              if (existingAfterConflict) return existingAfterConflict;
            }
            throw createError;
          }
        },
      });

      await auditLogService.record({
        contaId: input.contaId,
        actor: input.actor,
        action: 'finance.standalone_subscription.created',
        entity: { type: 'StandaloneSubscription', id: persisted.id },
        metadata: {
          chargeType: input.chargeType,
          asaasSubscriptionId: subscription.id,
          externalReference: subscriptionExternalReference,
          status: nextStatus,
          value: input.value,
          cycle: input.cycle,
          billingType: input.billingType,
          nextDueDate: input.nextDueDate,
          endDate: input.endDate ?? null,
          description: input.description ?? null,
          payerType,
          payerId,
          payerName: financialPayerName,
          displayName,
          localCustomerId: customerResult.data.localCustomerId,
          expectedWebhooks: ['SUBSCRIPTION_CREATED', 'PAYMENT_CREATED'],
        },
      });

      await materializeFirstSubscriptionPayment({
        contaId: input.contaId,
        subscriptionId: subscription.id,
        expectedDueDate: input.nextDueDate,
      });

      return ok({
        chargeId: persisted.id,
        asaasSubscriptionId: subscription.id,
        externalReference: persisted.externalReference,
        status: persisted.status,
        expectedWebhooks: ['SUBSCRIPTION_CREATED', 'PAYMENT_CREATED'],
        notificationSync,
      });
    }

    return err('ERRO_INTERNO');
  } catch (error) {
    console.error('[createStandaloneCharge]', error);
    return err('ERRO_INTERNO');
  }
}
