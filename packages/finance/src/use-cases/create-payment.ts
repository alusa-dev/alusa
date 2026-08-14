import { createPayment, AsaasHttpError } from '@alusa/asaas';
import { loadAsaasCredentials } from '@alusa/database';
import type { BillingType as AsaasBillingType } from '@alusa/asaas';
import type { Result } from '@alusa/shared';
import { ok, err } from '@alusa/shared';

import { requireKycApproved } from '../foundation/kyc-guard';
import {
  assertAsaasTenantOperational,
  FinanceBlockedError,
} from '../foundation/asaas-operational-guard';
import { buildSafeAsaasIdempotencyKey } from '../core';

export type CreatePaymentInput = {
  contaId: string;
  customer: string;
  billingType: AsaasBillingType;
  value: number;
  dueDate: string;
  description?: string;
  externalReference: string;
  idempotencyKey?: string;
  discount?: {
    value: number;
    type: 'FIXED' | 'PERCENTAGE';
    dueDateLimitDays?: number;
  };
  interest?: {
    value: number;
  };
  fine?: {
    value: number;
    type: 'FIXED' | 'PERCENTAGE';
  };
};

export type CreateAsaasPaymentFailure = {
  code: 'KYC_NOT_APPROVED' | 'FINANCE_CONFIGURATION' | 'PROVIDER_REJECTED' | 'RESULT_UNKNOWN';
  message: string;
  resultUnknown: boolean;
  httpStatus?: number;
};

export async function createAsaasPaymentDetailed(
  input: CreatePaymentInput,
): Promise<Result<{ id: string; externalReference: string; invoiceUrl?: string }, CreateAsaasPaymentFailure>> {
  try {
    const kyc = await requireKycApproved(input.contaId, { allowPendingBankAccount: true });
    if (!kyc.success) {
      return err({
        code: 'KYC_NOT_APPROVED',
        message: kyc.error,
        resultUnknown: false,
      });
    }

    await assertAsaasTenantOperational(input.contaId);

    const creds = await loadAsaasCredentials(input.contaId);
    if (!creds) {
      return err({
        code: 'FINANCE_CONFIGURATION',
        message: 'Credenciais Asaas não configuradas',
        resultUnknown: false,
      });
    }

    const payment = await createPayment({
      apiKey: creds.apiKey,
      idempotencyKey: buildSafeAsaasIdempotencyKey(input.idempotencyKey ?? input.externalReference),
      data: {
        customer: input.customer,
        billingType: input.billingType,
        value: input.value,
        dueDate: input.dueDate,
        description: input.description,
        externalReference: input.externalReference,
        discount: input.discount,
        interest: input.interest,
        fine: input.fine,
      },
    });

    return ok({
      id: payment.id,
      externalReference: payment.externalReference!,
      invoiceUrl: payment.invoiceUrl,
    });
  } catch (error) {
    if (error instanceof AsaasHttpError) {
      const providerRejected = error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status);
      if (providerRejected) {
        console.warn('[finance][createAsaasPayment] payload rejeitado pelo Asaas', {
          contaId: input.contaId,
          billingType: input.billingType,
          customer: input.customer,
          value: input.value,
          dueDate: input.dueDate,
          externalReference: input.externalReference,
          response: error.responseBody ?? error.response,
        });
      }
      return err({
        code: providerRejected ? 'PROVIDER_REJECTED' : 'RESULT_UNKNOWN',
        message: error.message || 'Erro ao criar pagamento',
        resultUnknown: !providerRejected,
        httpStatus: error.status,
      });
    }
    if (error instanceof FinanceBlockedError) {
      return err({
        code: 'FINANCE_CONFIGURATION',
        message: error.code,
        resultUnknown: false,
      });
    }
    return err({
      code: 'RESULT_UNKNOWN',
      message: error instanceof Error ? error.message : 'Erro ao criar pagamento',
      resultUnknown: true,
    });
  }
}

export async function createAsaasPayment(
  input: CreatePaymentInput,
): Promise<Result<{ id: string; externalReference: string; invoiceUrl?: string }, string>> {
  const result = await createAsaasPaymentDetailed(input);
  return result.success ? result : err(result.error.message);
}
