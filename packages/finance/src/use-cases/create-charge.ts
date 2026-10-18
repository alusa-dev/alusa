import { logFinanceOperationalEvent } from '../foundation/operational-log';
import { prisma } from '@alusa/database';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';
import type { BillingType as AsaasBillingType } from '@alusa/asaas';
import type { FormaPagamento } from '@prisma/client';
import { resolvePayer } from '@alusa/domain';

import { createAsaasPayment } from './create-payment';
import { ensureCustomer } from './ensure-customer';
import { auditLogService } from '../foundation/audit-log.service';
import { requireKycApproved } from '../foundation/kyc-guard';
import { isPastDate } from '../foundation/date-guard';
import { deriveDeterministicId, hashPayload } from '../core';
import { getBillingInfo, getPayment, listPayments } from './asaas-ops';
import {
  parseOutboundFinancialOperation,
  markOutboundAwaitingWebhook,
  markOutboundRemoteConfirmed,
  markOutboundRemoteRequested,
  markOutboundResultUnknown,
  markOutboundRequiresReconciliation,
  reserveOutboundFinancialOperation,
} from './outbound-financial-operation';
import { parseDiscountDueDateLimitDays } from './discount-rules';
import { assertCompleteAsaasPage } from './asaas-pagination';

export type CreateChargeInput = {
  contaId: string;
  cobrancaId: string;
  actor: { type: 'USER' | 'SYSTEM'; id?: string };
  dueDateOverride?: string;
};

export type CreateChargeOutput = {
  cobrancaId: string;
  chargeId: string;
  asaasPaymentId?: string;
  externalReference: string;
};

export type CreateChargeError =
  | 'COBRANCA_NAO_ENCONTRADA'
  | 'KYC_NAO_APROVADO'
  | 'COBRANCA_JA_POSSUI_PAGAMENTO'
  | 'PAGADOR_NAO_ENCONTRADO'
  | 'PAGADOR_SEM_CPF'
  | 'PAGADOR_CPF_INVALIDO'
  | 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
  | 'ERRO_AO_CRIAR_CUSTOMER'
  | 'ERRO_AO_CRIAR_PAGAMENTO'
  | 'DATA_INVALIDA'
  | 'ERRO_INTERNO';

function toAsaasBillingType(formaPagamento: FormaPagamento): AsaasBillingType {
  const map: Record<FormaPagamento, AsaasBillingType> = {
    BOLETO: 'BOLETO',
    PIX: 'PIX',
    CARTAO_CREDITO: 'CREDIT_CARD',
    INDEFINIDO: 'UNDEFINED',
  };

  return map[formaPagamento];
}

function toDueDateISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function createCharge(
  input: CreateChargeInput,
): Promise<Result<CreateChargeOutput, CreateChargeError>> {
  try {
    const kyc = await requireKycApproved(input.contaId);
    if (!kyc.success) return err(kyc.error);

    const cobranca = await prisma.cobranca.findFirst({
      where: {
        id: input.cobrancaId,
        matricula: { aluno: { contaId: input.contaId } },
      },
      select: {
        id: true,
        asaasPaymentId: true,
        asaasId: true,
        valor: true,
        vencimento: true,
        descricao: true,
        formaPagamento: true,
        // Campos financeiros
        jurosPercentual: true,
        multaTipo: true,
        multaPercentual: true,
        multaValorFixo: true,
        descontoTipo: true,
        descontoPercentual: true,
        descontoValorFixo: true,
        descontoPrazoMaximo: true,
        matricula: {
          select: {
            id: true,
            responsavelFinanceiroId: true,
            aluno: {
              select: {
                id: true,
                cpf: true,
                dataNasc: true,
              },
            },
            responsavelFinanceiro: {
              select: {
                id: true,
                cpf: true,
              },
            },
          },
        },
      },
    });

    if (!cobranca) return err('COBRANCA_NAO_ENCONTRADA');

    const legacyPaymentId = cobranca.asaasPaymentId ?? cobranca.asaasId ?? null;

    // ADR-006: externalReference deve referenciar o ID interno da entidade.
    const chargeExternalReference = `charge:${cobranca.id}`;

    const existingCharge = await prisma.charge.findUnique({
      where: { cobrancaId: cobranca.id },
      select: {
        id: true,
        asaasPaymentId: true,
        externalReference: true,
        status: true,
        payerType: true,
        payerId: true,
      },
    });

    const existingPaymentId = existingCharge?.asaasPaymentId ?? legacyPaymentId;
    if (existingPaymentId) {
      return ok({
        cobrancaId: cobranca.id,
        chargeId: existingCharge?.id ?? cobranca.id,
        asaasPaymentId: existingPaymentId,
        externalReference: existingCharge?.externalReference ?? chargeExternalReference,
      });
    }

    // Usar função canônica do domínio para determinar o pagador
    const payerResult = resolvePayer({
      alunoId: cobranca.matricula.aluno.id,
      alunoDataNasc: cobranca.matricula.aluno.dataNasc,
      responsavelFinanceiroId: cobranca.matricula.responsavelFinanceiroId,
    });

    if (!payerResult.success) {
      // Menor de idade sem responsável
      return err('PAGADOR_NAO_ENCONTRADO');
    }

    const payer = payerResult.payer;

    if (existingCharge && !existingCharge.payerType && !existingCharge.payerId) {
      await prisma.charge.updateMany({
        where: { id: existingCharge.id, contaId: input.contaId },
        data: { payerType: payer.type, payerId: payer.id },
      });
    }

    const customer = await ensureCustomer({ contaId: input.contaId, payer });
    if (!customer.success) {
      if (customer.error === 'PAGADOR_NAO_ENCONTRADO') return err('PAGADOR_NAO_ENCONTRADO');
      if (customer.error === 'PAGADOR_SEM_CPF') return err('PAGADOR_SEM_CPF');
      if (customer.error === 'PAGADOR_CPF_INVALIDO') return err('PAGADOR_CPF_INVALIDO');
      if (customer.error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS')
        return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');
      return err('ERRO_AO_CRIAR_CUSTOMER');
    }

    const externalReference = existingCharge?.externalReference ?? chargeExternalReference;
    const billingType = toAsaasBillingType(cobranca.formaPagamento);

    // Mapeamento de Juros (Asaas aceita apenas mensal percentual para pagamentos unicos?)
    // O type definition diz que interest tem apenas { value: number }. O texto diz "Percentage per month".
    // Se o banco tem jurosValorFixo, não podemos usar diretamente a menos que convertamos.
    // Por hora, usamos apenas jurosPercentual se disponível.
    const interest = cobranca.jurosPercentual
      ? { value: Number(cobranca.jurosPercentual) }
      : undefined;

    // Mapeamento de Multa
    let fine: { value: number; type: 'FIXED' | 'PERCENTAGE' } | undefined;
    if (
      cobranca.multaTipo === 'VALOR_FIXO' &&
      cobranca.multaValorFixo &&
      Number(cobranca.multaValorFixo) > 0
    ) {
      fine = { value: Number(cobranca.multaValorFixo), type: 'FIXED' };
    } else if (
      cobranca.multaTipo === 'PERCENTUAL' &&
      cobranca.multaPercentual &&
      Number(cobranca.multaPercentual) > 0
    ) {
      fine = { value: Number(cobranca.multaPercentual), type: 'PERCENTAGE' };
    }

    // Mapeamento de Desconto
    let discount:
      | { value: number; type: 'FIXED' | 'PERCENTAGE'; dueDateLimitDays: number }
      | undefined;
    const discountValue =
      cobranca.descontoTipo === 'VALOR_FIXO'
        ? Number(cobranca.descontoValorFixo)
        : Number(cobranca.descontoPercentual);

    if (discountValue > 0) {
      discount = {
        value: discountValue,
        type: cobranca.descontoTipo === 'VALOR_FIXO' ? 'FIXED' : 'PERCENTAGE',
        dueDateLimitDays: parseDiscountDueDateLimitDays(cobranca.descontoPrazoMaximo),
      };
    }

    const dueDateIso =
      typeof input.dueDateOverride === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.dueDateOverride)
        ? input.dueDateOverride
        : toDueDateISO(cobranca.vencimento);
    if (isPastDate(dueDateIso)) {
      return err('DATA_INVALIDA');
    }

    const paymentInput = {
      contaId: input.contaId,
      customer: customer.data.customerId,
      billingType,
      value: Number(cobranca.valor),
      dueDate: dueDateIso,
      description: cobranca.descricao ?? undefined,
      externalReference,
      idempotencyKey: externalReference,
      interest,
      fine,
      discount,
    };

    const chargeId =
      existingCharge?.id ?? deriveDeterministicId('ch', `${input.contaId}:${cobranca.id}`);
    if (!existingCharge) {
      await prisma.charge
        .create({
          data: {
            id: chargeId,
            contaId: input.contaId,
            cobrancaId: cobranca.id,
            externalReference,
            status: 'PENDING_SYNC',
            statusUpdatedAt: new Date(),
            description: cobranca.descricao,
            value: cobranca.valor,
            dueDate: new Date(`${dueDateIso}T00:00:00.000Z`),
            billingType,
            customerId: customer.data.localCustomerId,
            payerType: payer.type,
            payerId: payer.id,
          },
        })
        .catch(async (reserveError) => {
          const concurrent = await prisma.charge.findFirst({
            where: { contaId: input.contaId, cobrancaId: cobranca.id, externalReference },
            select: { id: true },
          });
          if (!concurrent) throw reserveError;
        });
    }

    const operation = await reserveOutboundFinancialOperation({
      contaId: input.contaId,
      type: 'CREATE_PAYMENT',
      idempotencyKey: externalReference,
      resource: 'PAYMENT',
      entityId: cobranca.id,
      externalReference,
      requestFingerprint: hashPayload(paymentInput),
      links: { chargeId, cobrancaId: cobranca.id },
    });

    let remotePayment = operation.payload.remoteId
      ? await getPayment(operation.payload.remoteId, { contaId: input.contaId }).catch(() => null)
      : null;
    let remoteLookupComplete = false;
    let remoteLookupConflict = false;
    let remoteLookupConflictReason = 'MULTIPLE_REMOTE_PAYMENTS_FOR_EXTERNAL_REFERENCE';
    const findRemotePayment = async () => {
      const matches: Awaited<ReturnType<typeof listPayments>>['data'] = [];
      const seenPages = new Set<string>();
      const seenIds = new Set<string>();
      let expectedTotalCount: number | undefined;
      let complete = false;
      for (let page = 0; page < 100; page += 1) {
        const result = await listPayments(
          { externalReference, offset: page * 100, limit: 100, includeDeleted: true },
          { contaId: input.contaId },
        ).catch(() => null);
        if (!result) break;
        try {
          expectedTotalCount = assertCompleteAsaasPage(result, page * 100, 100, expectedTotalCount);
        } catch { break; }
        const ids = result.data.map((payment) => payment.id);
        const signature = ids.slice().sort().join('|');
        if ((ids.length > 0 && seenPages.has(signature)) || ids.some((id) => seenIds.has(id))) break;
        if (ids.length > 0) seenPages.add(signature);
        ids.forEach((id) => seenIds.add(id));
        if (result.data.some((payment) => payment.externalReference !== externalReference)) {
          remoteLookupConflict = true;
          remoteLookupConflictReason = 'PAYMENT_EXTERNAL_REFERENCE_MISMATCH';
        }
        matches.push(...result.data.filter((payment) => payment.externalReference === externalReference));
        if (!result.hasMore) {
          complete = true;
          break;
        }
      }
      if (matches.length > 1) remoteLookupConflict = true;
      const match = matches.length === 1 ? matches[0]! : null;
      const confirmed = match
        ? await getPayment(match.id, { contaId: input.contaId }).catch(() => null)
        : null;
      remoteLookupComplete = complete && (!match || Boolean(confirmed));
      return { matches, payment: confirmed, complete: remoteLookupComplete };
    };
    const waitForConcurrentPayment = async () => {
      for (let attempt = 0; attempt < 5 && !remotePayment; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const persisted = await prisma.asaasIntegrationJob.findFirst({
          where: { id: operation.job.id, contaId: input.contaId },
          select: { payload: true },
        });
        const persistedOperation = persisted
          ? parseOutboundFinancialOperation(persisted.payload)
          : null;
        if (persistedOperation?.remoteId) {
          remotePayment = await getPayment(persistedOperation.remoteId, {
            contaId: input.contaId,
          }).catch(() => null);
          if (remotePayment) break;
        }
        const recovered = await findRemotePayment();
        if (remoteLookupConflict) break;
        if (recovered.complete) remotePayment = recovered.payment;
      }
    };
    if (!remotePayment) {
      const recovered = await findRemotePayment();
      // A match from a partial page set does not establish uniqueness.
      if (recovered.complete) remotePayment = recovered.payment;
    }
    if (remoteLookupConflict) {
      await markOutboundRequiresReconciliation({
        jobId: operation.job.id,
        contaId: input.contaId,
        resource: 'PAYMENT',
        entityId: cobranca.id,
        externalReference,
        error: remoteLookupConflictReason,
      });
      return err('ERRO_AO_CRIAR_PAGAMENTO');
    }
    const operationIsInFlight =
      operation.payload.state === 'REMOTE_REQUESTED' ||
      operation.payload.state === 'REMOTE_CONFIRMED' ||
      operation.payload.state === 'AWAITING_WEBHOOK';
    const operationHasDurableRemoteConfirmation =
      operation.payload.state === 'REMOTE_CONFIRMED' ||
      operation.payload.state === 'AWAITING_WEBHOOK' ||
      operation.payload.state === 'SYNCHRONIZED';
    if (!remotePayment && operationIsInFlight) {
      await waitForConcurrentPayment();
      if (remoteLookupConflict) {
        await markOutboundRequiresReconciliation({
          jobId: operation.job.id,
          contaId: input.contaId,
          resource: 'PAYMENT',
          entityId: cobranca.id,
          externalReference,
          error: remoteLookupConflictReason,
        });
        return err('ERRO_AO_CRIAR_PAGAMENTO');
      }
    }
    if (!remotePayment && operationHasDurableRemoteConfirmation) {
      return err('ERRO_AO_CRIAR_PAGAMENTO');
    }
    if (!remotePayment && !remoteLookupComplete) {
      if (operation.payload.state !== 'INTENT_CREATED') {
        await markOutboundResultUnknown({
          jobId: operation.job.id,
          contaId: input.contaId,
          resource: 'PAYMENT',
          entityId: cobranca.id,
          externalReference,
          error: 'PAYMENT_RECONCILIATION_LOOKUP_INCOMPLETE',
        });
      }
      return err('ERRO_AO_CRIAR_PAGAMENTO');
    }
    if (!remotePayment && operation.payload.state !== 'INTENT_CREATED') {
      await markOutboundResultUnknown({
        jobId: operation.job.id,
        contaId: input.contaId,
        resource: 'PAYMENT',
        entityId: cobranca.id,
        externalReference,
        error: 'PREVIOUS_PAYMENT_CREATE_RESULT_NOT_CONFIRMED',
      });
      return err('ERRO_AO_CRIAR_PAGAMENTO');
    }
    if (!remotePayment) {
      const claimed = await markOutboundRemoteRequested(operation.job.id);
      if (!claimed) {
        // Another request owns the POST. Prefer the tenant-scoped durable
        // operation record; only fall back to the provider lookup while the
        // winner is still completing its persisted confirmation.
        await waitForConcurrentPayment();
        if (remoteLookupConflict) {
          await markOutboundRequiresReconciliation({
            jobId: operation.job.id,
            contaId: input.contaId,
            resource: 'PAYMENT',
            entityId: cobranca.id,
            externalReference,
            error: remoteLookupConflictReason,
          });
          return err('ERRO_AO_CRIAR_PAGAMENTO');
        }
        if (!remotePayment) return err('ERRO_AO_CRIAR_PAGAMENTO');
      } else {
      const payment = await createAsaasPayment(paymentInput);
      if (payment.success) {
        remotePayment = await getPayment(payment.data.id, { contaId: input.contaId }).catch(
          () =>
            ({
              ...payment.data,
              status: 'PENDING',
            }) as Awaited<ReturnType<typeof getPayment>>,
        );
      } else {
        const recovered = await findRemotePayment();
        if (remoteLookupConflict) {
          await markOutboundRequiresReconciliation({
            jobId: operation.job.id,
            contaId: input.contaId,
            resource: 'PAYMENT',
            entityId: cobranca.id,
            externalReference,
            error: remoteLookupConflictReason,
          });
          return err('ERRO_AO_CRIAR_PAGAMENTO');
        }
        if (recovered.complete && recovered.payment) remotePayment = recovered.payment;
        else {
          await markOutboundResultUnknown({
            jobId: operation.job.id,
            contaId: input.contaId,
            resource: 'PAYMENT',
            entityId: cobranca.id,
            externalReference,
            error: payment.error,
          });
          if (payment.error === 'KYC_NAO_APROVADO') return err('KYC_NAO_APROVADO');
          if (payment.error === 'Credenciais Asaas não configuradas')
            return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');
          return err('ERRO_AO_CRIAR_PAGAMENTO');
        }
      }
      }
    }
    const paymentMismatch =
      !remotePayment?.id ||
      remotePayment.externalReference !== externalReference ||
      (remotePayment.customer != null && remotePayment.customer !== customer.data.customerId) ||
      (remotePayment.value != null &&
        Math.abs(remotePayment.value - Number(cobranca.valor)) > 0.001) ||
      (remotePayment.dueDate != null && remotePayment.dueDate !== dueDateIso);
    if (paymentMismatch) {
      await markOutboundRequiresReconciliation({
        jobId: operation.job.id,
        contaId: input.contaId,
        resource: 'PAYMENT',
        entityId: cobranca.id,
        externalReference,
        error: 'REMOTE_PAYMENT_CONFIRMATION_MISMATCH',
      });
      return err('ERRO_AO_CRIAR_PAGAMENTO');
    }
    await markOutboundRemoteConfirmed(operation.job.id, remotePayment.id, {
      providerStatus: remotePayment.status,
    });
    const boletoInfo =
      billingType === 'BOLETO'
        ? await getBillingInfo(remotePayment.id, { contaId: input.contaId }).catch(() => null)
        : null;
    const boletoData =
      billingType === 'BOLETO'
        ? {
            bankSlipUrl: remotePayment.bankSlipUrl ?? boletoInfo?.bankSlip?.bankSlipUrl ?? null,
            identificationField: boletoInfo?.bankSlip?.identificationField ?? null,
            barCode: boletoInfo?.bankSlip?.barCode ?? null,
            nossoNumero: boletoInfo?.bankSlip?.nossoNumero ?? null,
          }
        : {};
    await prisma.charge.updateMany({
      where: { id: chargeId, contaId: input.contaId },
      data: {
        asaasPaymentId: remotePayment.id,
        invoiceUrl: remotePayment.invoiceUrl ?? null,
        ...boletoData,
      },
    });
    await prisma.cobranca.updateMany({
      where: { id: cobranca.id, matricula: { aluno: { contaId: input.contaId } } },
      data: boletoData,
    });
    await markOutboundAwaitingWebhook(operation.job.id, remotePayment.id);

    await auditLogService.record({
      contaId: input.contaId,
      actor: input.actor,
      action: 'finance.charge.payment_requested',
      entity: { type: 'Cobranca', id: cobranca.id },
      metadata: {
        cobrancaId: cobranca.id,
        chargeId,
        asaasPaymentId: remotePayment.id,
        externalReference,
        awaitingOfficialMaterialization: true,
      },
    });

    return ok({
      cobrancaId: cobranca.id,
      chargeId,
      asaasPaymentId: remotePayment.id,
      externalReference,
    });
  } catch (error) {
    logFinanceOperationalEvent({
      severity: 'error',
      eventName: 'finance.use_cases.create_charge.failed',
      error: error,
      throttleMs: 60_000,
    });
    return err('ERRO_INTERNO');
  }
}
