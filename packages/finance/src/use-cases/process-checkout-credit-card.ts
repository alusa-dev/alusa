import {
  createCustomer,
  createPayment,
  payWithCreditCard,
  tokenizeCreditCard,
  type AsaasCreditCard,
  type AsaasCreditCardHolderInfo,
  type BillingType,
} from '@alusa/asaas';
import { loadAsaasCredentials } from '@alusa/database';
import { err, ok, type Result } from '@alusa/shared';

import { requireKycApproved } from '../foundation/kyc-guard';
import { ensureWebhookConfigOperational } from '../webhooks/ensure-webhook-config-operational';

export type ProcessCheckoutCreditCardInput = {
  contaId: string;
  pagador: {
    externalReference: string;
    name: string;
    cpfCnpj: string;
    email: string;
    phone: string;
    postalCode: string;
    addressNumber: string;
    asaasCustomerId?: string | null;
  };
  cobranca: {
    externalReference: string;
    value: number;
    dueDate: string;
    description?: string;
    asaasPaymentId?: string | null;
  };
  card: AsaasCreditCard;
  remoteIp?: string;
};

export type ProcessCheckoutCreditCardOutput = {
  customerId: string;
  creditCardToken: string;
  paymentId: string;
};

export async function processCheckoutCreditCard(
  input: ProcessCheckoutCreditCardInput,
): Promise<Result<ProcessCheckoutCreditCardOutput, string>> {
  try {
    const kyc = await requireKycApproved(input.contaId);
    if (!kyc.success) return err(kyc.error);

    await ensureWebhookConfigOperational(input.contaId);

    const creds = await loadAsaasCredentials(input.contaId);
    if (!creds) {
      return err('Credenciais Asaas não configuradas');
    }

    const holderInfo: AsaasCreditCardHolderInfo = {
      name: input.pagador.name,
      email: input.pagador.email,
      cpfCnpj: input.pagador.cpfCnpj,
      postalCode: input.pagador.postalCode,
      addressNumber: input.pagador.addressNumber,
      phone: input.pagador.phone,
    };

    let customerId = input.pagador.asaasCustomerId ?? undefined;

    if (!customerId) {
      const customer = await createCustomer({
        apiKey: creds.apiKey,
        idempotencyKey: input.pagador.externalReference,
        data: {
          name: input.pagador.name,
          cpfCnpj: input.pagador.cpfCnpj,
          email: input.pagador.email,
          phone: input.pagador.phone,
          externalReference: input.pagador.externalReference,
        },
      });

      customerId = customer.id;
    }

    if (!customerId) {
      return err('Não foi possível identificar o customer do pagador');
    }

    const tokenized = await tokenizeCreditCard({
      apiKey: creds.apiKey,
      data: {
        customer: customerId,
        creditCard: input.card,
        creditCardHolderInfo: holderInfo,
        remoteIp: input.remoteIp,
      },
    });

    const creditCardToken = tokenized.creditCardToken;
    if (!creditCardToken) {
      return err('Falha ao tokenizar cartão');
    }

    const billingType: BillingType = 'CREDIT_CARD';

    const existingPaymentId = input.cobranca.asaasPaymentId ?? undefined;
    if (!existingPaymentId) {
      const payment = await createPayment({
        apiKey: creds.apiKey,
        idempotencyKey: input.cobranca.externalReference,
        data: {
          customer: customerId,
          billingType,
          value: input.cobranca.value,
          dueDate: input.cobranca.dueDate,
          description: input.cobranca.description,
          externalReference: input.cobranca.externalReference,
          creditCard: input.card,
          creditCardHolderInfo: holderInfo,
          creditCardToken,
          remoteIp: input.remoteIp,
        },
      });

      return ok({ customerId, creditCardToken, paymentId: payment.id });
    }

    const paid = await payWithCreditCard({
      apiKey: creds.apiKey,
      paymentId: existingPaymentId,
      data: {
        creditCard: input.card,
        creditCardHolderInfo: holderInfo,
        creditCardToken,
        remoteIp: input.remoteIp,
      },
    });

    return ok({ customerId, creditCardToken, paymentId: paid.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao processar checkout no Asaas';
    return err(message);
  }
}
