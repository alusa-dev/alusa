import { logFinanceOperationalEvent } from '../foundation/operational-log';
import {
  AsaasHttpError,
  createCustomer,
  getCustomer,
  listCustomers,
  restoreCustomer,
  updateCustomer,
} from '@alusa/asaas';
import type { AsaasCustomer } from '@alusa/asaas';
import { loadAsaasCredentials } from '@alusa/database';
import type { Result } from '@alusa/shared';
import { ok, err } from '@alusa/shared';

import { assertAsaasTenantOperational } from '../foundation/asaas-operational-guard';
import { hashPayload } from '../core';
import {
  markOutboundFailed,
  markOutboundRemoteConfirmed,
  markOutboundRemoteRequested,
  markOutboundRequiresReconciliation,
  markOutboundResultUnknown,
  markOutboundSynchronized,
  reserveOutboundFinancialOperation,
} from './outbound-financial-operation';
import { isAmbiguousAsaasCustomerCreateError } from './asaas-customer-create-recovery';
import { isValidCpfCnpjDigits } from '@alusa/shared/validators/cpf-cnpj';

export type CreateCustomerInput = {
  contaId: string;
  name: string;
  cpfCnpj: string;
  email?: string;
  phone?: string;
  externalReference: string;
};

export type SyncAsaasCustomerContactInput = CreateCustomerInput & {
  customerId: string;
};

function normalizePhone(value?: string): string | undefined {
  const digits = value?.replace(/\D/g, '') ?? '';
  return digits || undefined;
}

function buildCustomerPhonePayload(phone?: string): { phone?: string; mobilePhone?: string } {
  const normalized = normalizePhone(phone);
  if (!normalized) return {};

  return {
    phone: normalized,
    mobilePhone: normalized,
  };
}

function normalizeDocument(value?: string | null): string {
  return value?.replace(/\D/g, '') ?? '';
}

function findReusableCustomerByDocument(
  customers: AsaasCustomer[],
  cpfCnpj: string,
): AsaasCustomer | undefined {
  const normalizedCpfCnpj = normalizeDocument(cpfCnpj);
  if (!normalizedCpfCnpj) return undefined;

  const matchingCustomers = customers.filter(
    (customer) => normalizeDocument(customer.cpfCnpj) === normalizedCpfCnpj,
  );

  return matchingCustomers.find((customer) => !customer.deleted) ?? matchingCustomers[0];
}

async function listAllCustomersBy(
  apiKey: string,
  filters: { cpfCnpj?: string; externalReference?: string },
): Promise<AsaasCustomer[]> {
  const customers: AsaasCustomer[] = [];
  const seenIds = new Set<string>();
  const seenPages = new Set<string>();
  let expectedTotalCount: number | undefined;
  for (let page = 0; page < 100; page += 1) {
    const result = await listCustomers({ apiKey, ...filters, offset: page * 100, limit: 100 });
    if (
      !result ||
      !Array.isArray(result.data) ||
      !Number.isInteger(result.totalCount) || result.totalCount < 0 ||
      typeof result.hasMore !== 'boolean' ||
      result.offset !== page * 100 ||
      result.limit !== 100
    ) {
      throw new Error('CUSTOMER_LOOKUP_RESPONSE_INCOMPLETE');
    }
    if (expectedTotalCount !== undefined && expectedTotalCount !== result.totalCount) {
      throw new Error('CUSTOMER_LOOKUP_TOTAL_COUNT_CHANGED');
    }
    if (result.hasMore && result.data.length !== 100) {
      throw new Error('CUSTOMER_LOOKUP_SHORT_PAGE_WITH_MORE');
    }
    expectedTotalCount = result.totalCount;
    const collected = page * 100 + result.data.length;
    if (collected > result.totalCount || result.hasMore === (collected >= result.totalCount)) {
      throw new Error('CUSTOMER_LOOKUP_TOTAL_COUNT_MISMATCH');
    }
    const ids = result.data.map((customer) => customer.id);
    const signature = ids.slice().sort().join('|');
    if (ids.some((id) => !id?.trim()) || (ids.length > 0 && seenPages.has(signature)) || ids.some((id) => seenIds.has(id))) {
      throw new Error('CUSTOMER_LOOKUP_PAGINATION_REPEATED');
    }
    if (ids.length > 0) seenPages.add(signature);
    ids.forEach((id) => seenIds.add(id));
    customers.push(...result.data);
    if (!result.hasMore) return customers;
    if (result.data.length === 0) throw new Error('CUSTOMER_LOOKUP_RESPONSE_INCOMPLETE');
  }
  throw new Error('CUSTOMER_LOOKUP_PAGE_LIMIT_REACHED');
}

type CustomerOperationCreateResult =
  | { ok: true; customer: AsaasCustomer; reused: boolean }
  | { ok: false; disposition: 'UNKNOWN' | 'RECONCILIATION' | 'FAILED' | 'CLAIMED' | 'ABSENT'; message: string; status?: number };

function customerMatchesIdentity(
  customer: AsaasCustomer,
  externalReference: string,
  cpfCnpj: string,
): boolean {
  return customer.externalReference === externalReference &&
    normalizeDocument(customer.cpfCnpj) === normalizeDocument(cpfCnpj);
}

/**
 * Claims the durable customer-create intent and never repeats an already
 * requested POST without a complete exact-reference/document reconciliation.
 * Contact fields intentionally do not participate in the identity fingerprint.
 */
export async function createCustomerWithOutboundOperation(params: {
  contaId: string;
  apiKey: string;
  data: Omit<CreateCustomerInput, 'contaId'>;
  payerIdentity?: { type: 'ALUNO' | 'RESPONSAVEL'; id: string };
  lookupOnly?: boolean;
}): Promise<CustomerOperationCreateResult> {
  const { externalReference } = params.data;
  const cpfCnpj = normalizeDocument(params.data.cpfCnpj);
  const refPrefix = `customer:${params.contaId}:`;
  const parsedIdentity = externalReference.startsWith(refPrefix)
    ? externalReference.slice(refPrefix.length).split(':')
    : [];
  const identity = params.payerIdentity
    ? `${params.payerIdentity.type}:${params.payerIdentity.id}`
    : parsedIdentity.length >= 2
      ? `${parsedIdentity[0]}:${parsedIdentity.slice(1).join(':')}`
      : externalReference;
  const identityKey = hashPayload({ contaId: params.contaId, identity });
  const identityFingerprint = hashPayload({ contaId: params.contaId, identity, externalReference, cpfCnpj });
  const operation = await reserveOutboundFinancialOperation({
    contaId: params.contaId,
    type: 'CREATE_CUSTOMER',
    idempotencyKey: `customer:${identityKey}`,
    resource: 'CUSTOMER',
    entityId: externalReference,
    externalReference,
    requestFingerprint: identityFingerprint,
    metadata: { cpfCnpjFingerprint: hashPayload(cpfCnpj) },
  });

  let lookupAmbiguous = false;
  let lookupReason = 'MULTIPLE_REMOTE_CUSTOMERS_FOR_IDENTITY';
  const findRemoteCustomer = async () => {
    const customers: AsaasCustomer[] = [];
    const seenPages = new Set<string>();
    const seenIds = new Set<string>();
    let expectedTotalCount: number | undefined;
    let complete = false;
    for (let page = 0; page < 100; page += 1) {
      const response = await listCustomers({
        apiKey: params.apiKey,
        externalReference,
        offset: page * 100,
        limit: 100,
      }).catch(() => null);
      if (
        !response ||
        !Array.isArray(response.data) ||
        !Number.isInteger(response.totalCount) || response.totalCount < 0 ||
        typeof response.hasMore !== 'boolean' ||
        response.offset !== page * 100 ||
        response.limit !== 100
      ) break;
      if (expectedTotalCount !== undefined && expectedTotalCount !== response.totalCount) break;
      if (response.hasMore && response.data.length !== 100) break;
      expectedTotalCount = response.totalCount;
      const collected = page * 100 + response.data.length;
      if (collected > response.totalCount || response.hasMore === (collected >= response.totalCount)) break;
      const ids = response.data.map((customer) => customer.id);
      const signature = ids.slice().sort().join('|');
      if (ids.some((id) => !id?.trim()) || (ids.length > 0 && seenPages.has(signature)) || ids.some((id) => seenIds.has(id))) break;
      if (ids.length > 0) seenPages.add(signature);
      ids.forEach((id) => seenIds.add(id));
      if (response.data.some((customer) => customer.externalReference !== externalReference)) {
        lookupAmbiguous = true;
        lookupReason = 'CUSTOMER_EXTERNAL_REFERENCE_MISMATCH';
      }
      customers.push(...response.data);
      if (!response.hasMore) {
        complete = true;
        break;
      }
      if (response.data.length === 0) break;
    }

    const exactReference = customers.filter((customer) => customer.externalReference === externalReference);
    if (exactReference.some((customer) => normalizeDocument(customer.cpfCnpj) !== cpfCnpj)) {
      lookupAmbiguous = true;
      lookupReason = 'CUSTOMER_DOCUMENT_MISMATCH_FOR_EXTERNAL_REFERENCE';
    }
    const exactIdentity = exactReference.filter((customer) => normalizeDocument(customer.cpfCnpj) === cpfCnpj);
    if (exactIdentity.length > 1) lookupAmbiguous = true;
    if (lookupAmbiguous || exactIdentity.length === 0) {
      return { customer: null, complete: complete && exactIdentity.length === 0, found: exactIdentity.length > 0 };
    }
    const confirmed = await getCustomer({ apiKey: params.apiKey, customerId: exactIdentity[0]!.id }).catch(() => null);
    if (!confirmed) return { customer: null, complete: false, found: true };
    if (!customerMatchesIdentity(confirmed, externalReference, cpfCnpj) || confirmed.id !== exactIdentity[0]!.id) {
      lookupAmbiguous = true;
      lookupReason = 'CUSTOMER_GET_IDENTITY_MISMATCH';
      return { customer: null, complete: false, found: true };
    }
    return { customer: complete ? confirmed : null, complete: complete && Boolean(confirmed), found: true };
  };

  const reconcile = async (error: unknown, requiresReconciliation: boolean) => {
    const input = {
      jobId: operation.job.id,
      contaId: params.contaId,
      resource: 'CUSTOMER' as const,
      entityId: externalReference,
      externalReference,
      error,
    };
    if (requiresReconciliation) return markOutboundRequiresReconciliation(input);
    return markOutboundResultUnknown(input);
  };

  const preflight = await findRemoteCustomer();
  if (lookupAmbiguous) {
    await reconcile(lookupReason, true);
    return { ok: false, disposition: 'RECONCILIATION', message: 'Correspondência de customer ambígua; reconciliação necessária.' };
  }
  if (preflight.customer) {
    if (preflight.customer.deleted && !params.lookupOnly) {
      await reconcile('CUSTOMER_DELETED_REQUIRES_RECONCILIATION', true);
      return { ok: false, disposition: 'RECONCILIATION', message: 'Customer removido; reconciliação necessária antes de criar cobrança.' };
    }
    await markOutboundRemoteConfirmed(operation.job.id, preflight.customer.id);
    await markOutboundSynchronized(operation.job.id, preflight.customer.id);
    return { ok: true, customer: preflight.customer, reused: true };
  }
  if (!preflight.complete) {
    if (operation.payload.state !== 'INTENT_CREATED' || preflight.found) {
      await reconcile('CUSTOMER_RECONCILIATION_LOOKUP_INCOMPLETE', false);
    }
    return { ok: false, disposition: 'UNKNOWN', message: 'Busca de customer incompleta; criação bloqueada.' };
  }
  if (params.lookupOnly) {
    return { ok: false, disposition: 'ABSENT', message: 'Nenhum customer correspondente foi encontrado.' };
  }
  if (operation.payload.state !== 'INTENT_CREATED') {
    await reconcile('PREVIOUS_CUSTOMER_CREATE_RESULT_NOT_CONFIRMED', false);
    return { ok: false, disposition: 'UNKNOWN', message: 'Criação anterior não confirmada; nova tentativa bloqueada.' };
  }

  if (!(await markOutboundRemoteRequested(operation.job.id))) {
    return { ok: false, disposition: 'CLAIMED', message: 'Outra chamada está criando este customer.' };
  }

  let created: AsaasCustomer;
  try {
    created = await createCustomer({ apiKey: params.apiKey, data: params.data });
  } catch (error) {
    const status = error instanceof AsaasHttpError ? error.status : undefined;
    const uncertain = isAmbiguousAsaasCustomerCreateError(error) || [409, 425, 429].includes(status ?? 0);
    if (!uncertain) {
      await markOutboundFailed(operation.job.id, error, { providerStatus: status });
      return { ok: false, disposition: 'FAILED', message: error instanceof Error ? error.message : 'Falha no Asaas.', status };
    }
    const recovered = await findRemoteCustomer();
    if (lookupAmbiguous) {
      await reconcile(lookupReason, true);
      return { ok: false, disposition: 'RECONCILIATION', message: 'Recuperação ambígua; reconciliação necessária.' };
    }
    if (!recovered.complete || !recovered.customer) {
      await reconcile(error, false);
      return { ok: false, disposition: 'UNKNOWN', message: 'Resultado do POST incerto; reconciliação necessária.' };
    }
    if (recovered.customer.deleted) {
      await reconcile('CUSTOMER_DELETED_REQUIRES_RECONCILIATION', true);
      return { ok: false, disposition: 'RECONCILIATION', message: 'Customer removido; reconciliação necessária.' };
    }
    await markOutboundRemoteConfirmed(operation.job.id, recovered.customer.id);
    await markOutboundSynchronized(operation.job.id, recovered.customer.id);
    return { ok: true, customer: recovered.customer, reused: true };
  }

  if (!created?.id) {
    await reconcile('CUSTOMER_CREATE_RESPONSE_MISSING_ID', false);
    return { ok: false, disposition: 'UNKNOWN', message: 'Asaas não confirmou ID de customer.' };
  }
  let confirmed = await getCustomer({ apiKey: params.apiKey, customerId: created.id }).catch(() => null);
  if (
    confirmed &&
    (confirmed.id !== created.id || !customerMatchesIdentity(confirmed, externalReference, cpfCnpj))
  ) {
    lookupAmbiguous = true;
    lookupReason = confirmed.id !== created.id
      ? 'CUSTOMER_POST_GET_ID_MISMATCH'
      : 'CUSTOMER_POST_GET_IDENTITY_MISMATCH';
  }
  if (!confirmed && !lookupAmbiguous) {
    const recovered = await findRemoteCustomer();
    if (recovered.complete) confirmed = recovered.customer;
  }
  if (lookupAmbiguous) {
    await reconcile(lookupReason, true);
    return { ok: false, disposition: 'RECONCILIATION', message: 'Confirmação do customer divergiu; reconciliação necessária.' };
  }
  if (!confirmed) {
    await reconcile('CUSTOMER_POST_CONFIRMATION_UNAVAILABLE', false);
    return { ok: false, disposition: 'UNKNOWN', message: 'Customer criado, mas não confirmado por GET.' };
  }
  if (confirmed.deleted) {
    await reconcile('CUSTOMER_DELETED_REQUIRES_RECONCILIATION', true);
    return { ok: false, disposition: 'RECONCILIATION', message: 'Customer removido; reconciliação necessária.' };
  }
  await markOutboundRemoteConfirmed(operation.job.id, confirmed.id);
  await markOutboundSynchronized(operation.job.id, confirmed.id);
  return { ok: true, customer: confirmed, reused: false };
}

export async function syncAsaasCustomerContact(
  input: SyncAsaasCustomerContactInput,
): Promise<Result<void, string>> {
  try {
    await assertAsaasTenantOperational(input.contaId);

    const creds = await loadAsaasCredentials(input.contaId);
    if (!creds) {
      return err('Credenciais Asaas não configuradas');
    }

    await updateCustomer({
      apiKey: creds.apiKey,
      customerId: input.customerId,
      data: {
        name: input.name.trim(),
        email: input.email?.trim().toLowerCase(),
        ...buildCustomerPhonePayload(input.phone),
        externalReference: input.externalReference,
      },
    });

    return ok(undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao atualizar customer';
    return err(message);
  }
}

export async function createAsaasCustomer(
  input: CreateCustomerInput,
): Promise<Result<{ id: string; externalReference: string }, string>> {
  if (!isValidCpfCnpjDigits(normalizeDocument(input.cpfCnpj))) {
    return err('CPF/CNPJ inválido');
  }
  try {
    await assertAsaasTenantOperational(input.contaId);

    const creds = await loadAsaasCredentials(input.contaId);
    if (!creds) {
      return err('Credenciais Asaas não configuradas');
    }

    const customerPayload = {
      name: input.name.trim(),
      cpfCnpj: normalizeDocument(input.cpfCnpj),
      email: input.email?.trim().toLowerCase(),
      ...buildCustomerPhonePayload(input.phone),
      externalReference: input.externalReference,
      notificationDisabled: false,
    };

    const byCpfCnpj = await listAllCustomersBy(creds.apiKey, {
      cpfCnpj: normalizeDocument(input.cpfCnpj),
    });

    const cpfMatches = byCpfCnpj.filter(
      (customer) => normalizeDocument(customer.cpfCnpj) === normalizeDocument(input.cpfCnpj),
    );
    if (cpfMatches.length > 1) {
      return err('Resultado ambíguo: múltiplos customers correspondem ao CPF/CNPJ. Reconcilie antes de vincular.');
    }
    const existingByCpf = findReusableCustomerByDocument(cpfMatches, input.cpfCnpj);
    if (existingByCpf?.id) {
      let reusable = existingByCpf;
      if (existingByCpf.externalReference === input.externalReference) {
        const confirmed = await createCustomerWithOutboundOperation({
          contaId: input.contaId,
          apiKey: creds.apiKey,
          data: customerPayload,
          lookupOnly: true,
        });
        if (!confirmed.ok) return err(confirmed.message);
        reusable = confirmed.customer;
      }
      const customerId = reusable.id;
      if (reusable.deleted) {
        await restoreCustomer({ apiKey: creds.apiKey, customerId });
      }
      await syncAsaasCustomerContact({
        ...input,
        customerId,
      });
      return ok({
        id: customerId,
        externalReference: reusable.externalReference ?? input.externalReference,
      });
    }

    const byExternal = await listAllCustomersBy(creds.apiKey, { externalReference: input.externalReference });
    if (byExternal.some((customer) => customer.externalReference === input.externalReference &&
      normalizeDocument(customer.cpfCnpj) !== normalizeDocument(input.cpfCnpj))) {
      return err('Resultado ambíguo: externalReference já pertence a outro CPF/CNPJ. Reconcilie antes de criar.');
    }

    const exactExternalMatches = byExternal.filter((customer) =>
      customer.externalReference === input.externalReference &&
      normalizeDocument(customer.cpfCnpj) === normalizeDocument(input.cpfCnpj),
    );
    if (exactExternalMatches.length > 1) {
      return err('Resultado ambíguo: múltiplos customers correspondem à referência e CPF/CNPJ. Reconcilie antes de vincular.');
    }
    const existingByExternal = findReusableCustomerByDocument(exactExternalMatches, input.cpfCnpj);
    if (existingByExternal?.id) {
      const confirmed = await createCustomerWithOutboundOperation({
        contaId: input.contaId,
        apiKey: creds.apiKey,
        data: customerPayload,
        lookupOnly: true,
      });
      if (!confirmed.ok) return err(confirmed.message);
      const customerId = confirmed.customer.id;
      if (confirmed.customer.deleted) {
        await restoreCustomer({ apiKey: creds.apiKey, customerId });
      }
      await syncAsaasCustomerContact({
        ...input,
        customerId,
      });
      return ok({
        id: customerId,
        externalReference: confirmed.customer.externalReference ?? input.externalReference,
      });
    }
    const creation = await createCustomerWithOutboundOperation({
      contaId: input.contaId,
      apiKey: creds.apiKey,
      data: customerPayload,
    });
    if (!creation.ok) return err(creation.message);
    return ok({ id: creation.customer.id, externalReference: creation.customer.externalReference ?? input.externalReference });
  } catch (error) {
    if (error instanceof AsaasHttpError) {
      logFinanceOperationalEvent({
        severity: 'warn',
        eventName: 'finance.use_cases.create_customer.degraded',
        error: error,
        throttleMs: 60_000,
      });
    }

    const message = error instanceof Error ? error.message : 'Erro ao criar customer';
    return err(message);
  }
}
