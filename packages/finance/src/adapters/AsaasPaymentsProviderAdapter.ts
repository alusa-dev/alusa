/**
 * AsaasPaymentsProviderAdapter — Implementação do PaymentsProviderPort usando Asaas
 * 
 * Regras:
 * - Read-before-write: sempre verifica se recurso existe antes de criar
 * - Idempotência: usa externalReference para evitar duplicidade
 * - Logs: registra todas as operações para auditoria
 */

import type {
  PaymentsProviderPort,
  ResolveOrCreateCustomerInput,
  ResolveOrCreateCustomerResult,
  CancelSubscriptionInput,
  CancelSubscriptionResult,
  ProviderCreateSubscriptionInput,
  ProviderCreateSubscriptionResult,
  ProviderCreatePaymentInput,
  ProviderCreatePaymentResult,
  ProviderListSubscriptionPaymentsResult,
} from '../ports/PaymentsProviderPort';
import {
  createCustomer,
  listCustomers,
  deleteSubscription,
  createSubscription,
  createPayment,
  listSubscriptionPayments,
} from '@alusa/asaas';
import type { Cycle, BillingType } from '@alusa/asaas';
import { buildSafeAsaasIdempotencyKey } from '../core';

export interface AsaasAdapterDeps {
  getApiKeyForConta: (contaId: string) => Promise<string>;
  logIntegration: (params: {
    contaId: string;
    operation: string;
    entity: string;
    entityId: string;
    asaasId?: string;
    status: 'SUCCESS' | 'ERROR';
    httpStatus?: number;
    request?: unknown;
    response?: unknown;
    errorMessage?: string;
    correlationId?: string;
  }) => Promise<void>;
}

export class AsaasPaymentsProviderAdapter implements PaymentsProviderPort {
  constructor(private deps: AsaasAdapterDeps) {}

  async resolveOrCreateCustomerForPayer(
    input: ResolveOrCreateCustomerInput
  ): Promise<ResolveOrCreateCustomerResult> {
    const apiKey = await this.deps.getApiKeyForConta(input.contaId);

    // 1. Buscar por externalReference (mais preciso)
    const byRef = await listCustomers({
      apiKey,
      externalReference: input.externalReference,
      limit: 1,
    });

    if (byRef.data.length > 0 && !byRef.data[0].deleted) {
      await this.deps.logIntegration({
        contaId: input.contaId,
        operation: 'RESOLVE_CUSTOMER',
        entity: 'Customer',
        entityId: input.payer.id,
        asaasId: byRef.data[0].id,
        status: 'SUCCESS',
        response: { found: true, method: 'externalReference' },
      });
      return { customerId: byRef.data[0].id, created: false };
    }

    // 2. Buscar por documento (fallback)
    const byCpf = await listCustomers({
      apiKey,
      cpfCnpj: input.payer.cpfCnpj.replace(/\D/g, ''),
      limit: 1,
    });

    if (byCpf.data.length > 0 && !byCpf.data[0].deleted) {
      await this.deps.logIntegration({
        contaId: input.contaId,
        operation: 'RESOLVE_CUSTOMER',
        entity: 'Customer',
        entityId: input.payer.id,
        asaasId: byCpf.data[0].id,
        status: 'SUCCESS',
        response: { found: true, method: 'cpfCnpj' },
      });
      return { customerId: byCpf.data[0].id, created: false };
    }

    // 3. Criar novo customer
    const customerData = {
      name: input.payer.name,
      cpfCnpj: input.payer.cpfCnpj.replace(/\D/g, ''),
      email: input.payer.email,
      phone: input.payer.phone,
      address: input.payer.address?.street,
      addressNumber: input.payer.address?.number,
      complement: input.payer.address?.complement,
      province: input.payer.address?.neighborhood,
      postalCode: input.payer.address?.postalCode?.replace(/\D/g, ''),
      externalReference: input.externalReference,
      notificationDisabled: false,
    };

    const created = await createCustomer({
      apiKey,
      data: customerData,
      idempotencyKey: buildSafeAsaasIdempotencyKey(`customer-${input.externalReference}`),
    });

    await this.deps.logIntegration({
      contaId: input.contaId,
      operation: 'CREATE_CUSTOMER',
      entity: 'Customer',
      entityId: input.payer.id,
      asaasId: created.id,
      status: 'SUCCESS',
      request: customerData,
      response: { id: created.id },
    });

    return { customerId: created.id, created: true };
  }

  async cancelSubscription(
    input: CancelSubscriptionInput
  ): Promise<CancelSubscriptionResult> {
    const apiKey = await this.deps.getApiKeyForConta(input.contaId);

    try {
      await deleteSubscription({
        apiKey,
        subscriptionId: input.subscriptionId,
      });

      await this.deps.logIntegration({
        contaId: input.contaId,
        operation: 'CANCEL_SUBSCRIPTION',
        entity: 'Subscription',
        entityId: input.subscriptionId,
        asaasId: input.subscriptionId,
        status: 'SUCCESS',
      });

      return { success: true };
    } catch (error: unknown) {
      const statusCode = (error as { response?: { status?: number } }).response?.status;

      // 404 = assinatura já não existe, considerar sucesso
      if (statusCode === 404) {
        await this.deps.logIntegration({
          contaId: input.contaId,
          operation: 'CANCEL_SUBSCRIPTION',
          entity: 'Subscription',
          entityId: input.subscriptionId,
          status: 'SUCCESS',
          httpStatus: 404,
          response: { notFound: true },
        });
        return { success: true, notFound: true };
      }

      await this.deps.logIntegration({
        contaId: input.contaId,
        operation: 'CANCEL_SUBSCRIPTION',
        entity: 'Subscription',
        entityId: input.subscriptionId,
        status: 'ERROR',
        httpStatus: statusCode,
        errorMessage: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  async createSubscription(
    input: ProviderCreateSubscriptionInput
  ): Promise<ProviderCreateSubscriptionResult> {
    const apiKey = await this.deps.getApiKeyForConta(input.contaId);

    const subscriptionData = {
      customer: input.customerId,
      value: input.value,
      nextDueDate: input.nextDueDate,
      cycle: input.cycle as Cycle,
      billingType: input.billingType as BillingType,
      description: input.description,
      externalReference: input.externalReference,
      endDate: input.endDate,
      discount: input.discount,
      interest: input.interest,
      fine: input.fine,
    };

    const created = await createSubscription({
      apiKey,
      data: subscriptionData,
      idempotencyKey: buildSafeAsaasIdempotencyKey(`subscription-${input.externalReference}`),
    });

    await this.deps.logIntegration({
      contaId: input.contaId,
      operation: 'CREATE_SUBSCRIPTION',
      entity: 'Subscription',
      entityId: input.externalReference,
      asaasId: created.id,
      status: 'SUCCESS',
      request: subscriptionData,
      response: { id: created.id, nextDueDate: created.nextDueDate, status: created.status },
    });

    return {
      subscriptionId: created.id,
      nextDueDate: created.nextDueDate,
      status: created.status,
    };
  }

  async createPayment(
    input: ProviderCreatePaymentInput
  ): Promise<ProviderCreatePaymentResult> {
    const apiKey = await this.deps.getApiKeyForConta(input.contaId);

    const paymentData = {
      customer: input.customerId,
      billingType: input.billingType as BillingType,
      value: input.value,
      dueDate: input.dueDate,
      description: input.description,
      externalReference: input.externalReference,
    };

    const created = await createPayment({
      apiKey,
      data: paymentData,
      idempotencyKey: buildSafeAsaasIdempotencyKey(`payment-${input.externalReference}`),
    });

    await this.deps.logIntegration({
      contaId: input.contaId,
      operation: 'CREATE_PAYMENT',
      entity: 'Payment',
      entityId: input.externalReference,
      asaasId: created.id,
      status: 'SUCCESS',
      request: paymentData,
      response: { id: created.id, status: created.status },
    });

    return {
      paymentId: created.id,
      status: created.status,
      invoiceUrl: created.invoiceUrl ?? undefined,
      bankSlipUrl: created.bankSlipUrl ?? undefined,
    };
  }

  async listSubscriptionPayments(
    subscriptionId: string,
    opts: { contaId: string; limit?: number; offset?: number }
  ): Promise<ProviderListSubscriptionPaymentsResult> {
    const apiKey = await this.deps.getApiKeyForConta(opts.contaId);

    const result = await listSubscriptionPayments({
      apiKey,
      subscriptionId,
      limit: opts.limit,
      offset: opts.offset,
    });

    return {
      data: (result.data ?? []).map((p) => ({
        id: String(p.id ?? ''),
        value: Number(p.value ?? 0),
        dueDate: String(p.dueDate ?? ''),
        status: String(p.status ?? ''),
        invoiceUrl: p.invoiceUrl ? String(p.invoiceUrl) : undefined,
        bankSlipUrl: p.bankSlipUrl ? String(p.bankSlipUrl) : undefined,
      })),
      totalCount: result.totalCount ?? 0,
    };
  }
}
