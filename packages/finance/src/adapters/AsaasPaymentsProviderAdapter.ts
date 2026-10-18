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
  listCustomers,
  deleteSubscription,
  createSubscription,
  createPayment,
  listSubscriptionPayments,
} from '@alusa/asaas';
import type { Cycle, BillingType } from '@alusa/asaas';
import { buildOutboundOperationKey } from '../core';
import { isValidCpfCnpjDigits } from '@alusa/shared/validators/cpf-cnpj';
import { createCustomerWithOutboundOperation } from '../use-cases/create-customer';

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

const CUSTOMER_LOOKUP_PAGE_SIZE = 100;
const CUSTOMER_LOOKUP_MAX_PAGES = 100;

function normalizeCustomerDocument(value?: string | null): string {
  return value?.replace(/\D/g, '') ?? '';
}

async function listCompleteCustomers(params: {
  apiKey: string;
  cpfCnpj?: string;
  externalReference?: string;
}) {
  const customers = [] as Awaited<ReturnType<typeof listCustomers>>['data'];
  const seenIds = new Set<string>();
  let expectedTotalCount: number | undefined;
  for (let page = 0; page < CUSTOMER_LOOKUP_MAX_PAGES; page += 1) {
    const offset = page * CUSTOMER_LOOKUP_PAGE_SIZE;
    const response = await listCustomers({
      ...params,
      offset,
      limit: CUSTOMER_LOOKUP_PAGE_SIZE,
    });
    if (
      !response ||
      !Array.isArray(response.data) ||
      !Number.isInteger(response.totalCount) || response.totalCount < 0 ||
      typeof response.hasMore !== 'boolean' ||
      response.offset !== offset ||
      response.limit !== CUSTOMER_LOOKUP_PAGE_SIZE
    ) throw new Error('ASAAS_CUSTOMER_LOOKUP_INCOMPLETE:INVALID_PAGE');
    if (expectedTotalCount !== undefined && expectedTotalCount !== response.totalCount) {
      throw new Error('ASAAS_CUSTOMER_LOOKUP_INCOMPLETE:TOTAL_COUNT_CHANGED');
    }
    if (response.hasMore && response.data.length !== CUSTOMER_LOOKUP_PAGE_SIZE) {
      throw new Error('ASAAS_CUSTOMER_LOOKUP_INCOMPLETE:SHORT_PAGE_WITH_MORE');
    }
    expectedTotalCount = response.totalCount;
    const collected = offset + response.data.length;
    if (collected > response.totalCount || response.hasMore === (collected >= response.totalCount)) {
      throw new Error('ASAAS_CUSTOMER_LOOKUP_INCOMPLETE:TOTAL_COUNT_MISMATCH');
    }
    if (response.data.some((customer) => {
      const id = typeof customer?.id === 'string' ? customer.id.trim() : '';
      if (!id || seenIds.has(id)) return true;
      seenIds.add(id);
      return false;
    })) throw new Error('ASAAS_CUSTOMER_LOOKUP_INCOMPLETE:REPEATED_OR_INVALID_ID');
    customers.push(...response.data);
    if (!response.hasMore) return customers;
    if (response.data.length === 0) throw new Error('ASAAS_CUSTOMER_LOOKUP_INCOMPLETE:EMPTY_PAGE_WITH_MORE');
  }
  throw new Error(`ASAAS_CUSTOMER_LOOKUP_INCOMPLETE:PAGE_LIMIT_EXCEEDED:${CUSTOMER_LOOKUP_MAX_PAGES}`);
}

function selectUniqueActiveCustomer<T extends { id: string; deleted?: boolean }>(customers: T[]): T | null {
  const active = customers.filter((customer) => !customer.deleted);
  if (active.length > 1) throw new Error('ASAAS_CUSTOMER_LOOKUP_AMBIGUOUS:MULTIPLE_MATCHES');
  return active[0] ?? null;
}

export class AsaasPaymentsProviderAdapter implements PaymentsProviderPort {
  constructor(private deps: AsaasAdapterDeps) {}

  async resolveOrCreateCustomerForPayer(
    input: ResolveOrCreateCustomerInput
  ): Promise<ResolveOrCreateCustomerResult> {
    const cpfCnpj = normalizeCustomerDocument(input.payer.cpfCnpj);
    if (!isValidCpfCnpjDigits(cpfCnpj)) {
      throw new Error('ASAAS_CUSTOMER_INVALID_CPF_CNPJ');
    }
    const apiKey = await this.deps.getApiKeyForConta(input.contaId);

    // 1. Buscar por externalReference (mais preciso)
    const byRef = await listCompleteCustomers({
      apiKey,
      externalReference: input.externalReference,
    });
    if (byRef.some((customer) => customer.externalReference !== input.externalReference)) {
      throw new Error('ASAAS_CUSTOMER_LOOKUP_MISMATCH:EXTERNAL_REFERENCE');
    }
    const matchingReference = byRef.filter((customer) =>
      customer.externalReference === input.externalReference &&
      normalizeCustomerDocument(customer.cpfCnpj) === cpfCnpj,
    );
    if (byRef.some((customer) =>
      customer.externalReference === input.externalReference &&
      normalizeCustomerDocument(customer.cpfCnpj) !== cpfCnpj,
    )) throw new Error('ASAAS_CUSTOMER_LOOKUP_MISMATCH:CPF_CNPJ');
    if (matchingReference.some((customer) => customer.deleted)) {
      throw new Error('ASAAS_CUSTOMER_DELETED_REQUIRES_RECONCILIATION');
    }
    const referenceCustomer = selectUniqueActiveCustomer(matchingReference);

    if (referenceCustomer) {
      await this.deps.logIntegration({
        contaId: input.contaId,
        operation: 'RESOLVE_CUSTOMER',
        entity: 'Customer',
        entityId: input.payer.id,
        asaasId: referenceCustomer.id,
        status: 'SUCCESS',
        response: { found: true, method: 'externalReference' },
      });
      return { customerId: referenceCustomer.id, created: false };
    }

    // 2. Buscar por documento (fallback)
    const byCpf = await listCompleteCustomers({
      apiKey,
      cpfCnpj: input.payer.cpfCnpj.replace(/\D/g, ''),
    });
    const matchingCpf = byCpf.filter((customer) =>
      normalizeCustomerDocument(customer.cpfCnpj) === cpfCnpj,
    );
    if (matchingCpf.some((customer) => customer.deleted)) {
      throw new Error('ASAAS_CUSTOMER_DELETED_REQUIRES_RECONCILIATION');
    }
    const cpfCustomer = selectUniqueActiveCustomer(matchingCpf);

    if (cpfCustomer) {
      await this.deps.logIntegration({
        contaId: input.contaId,
        operation: 'RESOLVE_CUSTOMER',
        entity: 'Customer',
        entityId: input.payer.id,
        asaasId: cpfCustomer.id,
        status: 'SUCCESS',
        response: { found: true, method: 'cpfCnpj' },
      });
      return { customerId: cpfCustomer.id, created: false };
    }

    // 3. Criar novo customer
    const customerData = {
      name: input.payer.name,
      cpfCnpj,
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

    const creation = await createCustomerWithOutboundOperation({
      contaId: input.contaId,
      apiKey,
      data: customerData,
      payerIdentity: { type: input.payer.type, id: input.payer.id },
    });
    if (!creation.ok) {
      throw new Error(`ASAAS_CUSTOMER_CREATE_${creation.disposition}:${creation.message}`);
    }
    if (creation.customer.deleted) {
      throw new Error('ASAAS_CUSTOMER_DELETED_REQUIRES_RECONCILIATION');
    }
    if (
      !creation.customer.id?.trim() ||
      creation.customer.externalReference !== input.externalReference ||
      normalizeCustomerDocument(creation.customer.cpfCnpj) !== cpfCnpj
    ) throw new Error('ASAAS_CUSTOMER_CREATE_IDENTITY_MISMATCH');

    await this.deps.logIntegration({
      contaId: input.contaId,
      operation: 'CREATE_CUSTOMER',
      entity: 'Customer',
      entityId: input.payer.id,
      asaasId: creation.customer.id,
      status: 'SUCCESS',
      request: customerData,
      response: { id: creation.customer.id },
    });

    return { customerId: creation.customer.id, created: !creation.reused };
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
      idempotencyKey: buildOutboundOperationKey(`subscription-${input.externalReference}`),
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
      idempotencyKey: buildOutboundOperationKey(`payment-${input.externalReference}`),
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
