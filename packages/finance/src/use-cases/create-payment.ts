import { createPayment, AsaasHttpError } from '@alusa/asaas';
import { loadAsaasCredentials } from '@alusa/database';
import type { BillingType as AsaasBillingType } from '@alusa/asaas';
import type { Result } from '@alusa/shared';
import { ok, err } from '@alusa/shared';

import { requireKycApproved } from '../foundation/kyc-guard';
import { ensureWebhookConfigOperational } from '../webhooks/ensure-webhook-config-operational';

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

export async function createAsaasPayment(
  input: CreatePaymentInput,
): Promise<Result<{ id: string; externalReference: string; invoiceUrl?: string }, string>> {
  try {
    const kyc = await requireKycApproved(input.contaId);
    if (!kyc.success) return err(kyc.error);

    await ensureWebhookConfigOperational(input.contaId);

    const creds = await loadAsaasCredentials(input.contaId);
    if (!creds) {
      return err('Credenciais Asaas não configuradas');
    }

    const payment = await createPayment({
      apiKey: creds.apiKey,
      idempotencyKey: input.idempotencyKey ?? input.externalReference,
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
      if (error.status === 400) {
        console.warn('[finance][createAsaasPayment] payload rejeitado pelo Asaas', {
          contaId: input.contaId,
          billingType: input.billingType,
          customer: input.customer,
          value: input.value,
          dueDate: input.dueDate,
          externalReference: input.externalReference,
          discount: input.discount,
          interest: input.interest,
          fine: input.fine,
          response: error.responseBody ?? error.response,
        });
      }
      return err(error.message || 'Erro ao criar pagamento');
    }
    const message = error instanceof Error ? error.message : 'Erro ao criar pagamento';
    return err(message);
  }
}
