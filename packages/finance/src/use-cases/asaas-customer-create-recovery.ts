import { AsaasHttpError, listCustomers } from '@alusa/asaas';
import type { AsaasCustomer } from '@alusa/asaas';

export class AmbiguousAsaasCustomerMatchesError extends Error {
  constructor() {
    super('Mais de um customer corresponde à referência e ao CPF/CNPJ informados.');
    this.name = 'AmbiguousAsaasCustomerMatchesError';
  }
}

function normalizeDigits(value?: string | null): string {
  return value?.replace(/\D/g, '') ?? '';
}

export function isAmbiguousAsaasCustomerCreateError(error: unknown): boolean {
  if (error instanceof AsaasHttpError) {
    return error.status === 408 || (error.status >= 500 && error.status <= 599);
  }

  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name === 'AbortError' || error.name === 'TimeoutError';
  }

  if (!(error instanceof Error)) return false;

  const code = (error as Error & { code?: string }).code;
  return (
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'EAI_AGAIN' ||
    /timeout|network|fetch failed|socket hang up|connection reset|aborted/i.test(error.message)
  );
}

/** Fresh read after an uncertain POST; both reference and document must match. */
export async function findCustomerAfterAmbiguousCreate(params: {
  apiKey: string;
  externalReference: string;
  cpfCnpj: string;
}): Promise<AsaasCustomer | null> {
  const expectedDocument = normalizeDigits(params.cpfCnpj);
  if (!expectedDocument) return null;

  const customers: AsaasCustomer[] = [];
  const seenIds = new Set<string>();
  const pageSize = 100;
  let expectedTotalCount: number | undefined;
  for (let page = 0; page < 100; page += 1) {
    const offset = page * pageSize;
    const response = await listCustomers({
      apiKey: params.apiKey,
      externalReference: params.externalReference,
      offset,
      limit: pageSize,
    });
    if (
      !response ||
      !Array.isArray(response.data) ||
      !Number.isInteger(response.totalCount) || response.totalCount < 0 ||
      typeof response.hasMore !== 'boolean' ||
      response.offset !== offset ||
      response.limit !== pageSize
    ) throw new Error('CUSTOMER_RECOVERY_LOOKUP_INCOMPLETE:INVALID_PAGE');
    if (expectedTotalCount !== undefined && expectedTotalCount !== response.totalCount) {
      throw new Error('CUSTOMER_RECOVERY_LOOKUP_INCOMPLETE:TOTAL_COUNT_CHANGED');
    }
    if (response.hasMore && response.data.length !== pageSize) {
      throw new Error('CUSTOMER_RECOVERY_LOOKUP_INCOMPLETE:SHORT_PAGE_WITH_MORE');
    }
    expectedTotalCount = response.totalCount;
    const collected = offset + response.data.length;
    if (collected > response.totalCount || response.hasMore === (collected >= response.totalCount)) {
      throw new Error('CUSTOMER_RECOVERY_LOOKUP_INCOMPLETE:TOTAL_COUNT_MISMATCH');
    }
    if (response.data.some((customer) => {
      const id = typeof customer?.id === 'string' ? customer.id.trim() : '';
      if (!id || seenIds.has(id)) return true;
      seenIds.add(id);
      return false;
    })) throw new Error('CUSTOMER_RECOVERY_LOOKUP_INCOMPLETE:REPEATED_OR_INVALID_ID');
    if (response.data.some((customer) => customer.externalReference !== params.externalReference)) {
      throw new Error('CUSTOMER_RECOVERY_LOOKUP_AMBIGUOUS:EXTERNAL_REFERENCE_MISMATCH');
    }
    customers.push(...response.data);
    if (!response.hasMore) break;
    if (response.data.length === 0) throw new Error('CUSTOMER_RECOVERY_LOOKUP_INCOMPLETE:EMPTY_PAGE_WITH_MORE');
    if (page === 99) throw new Error('CUSTOMER_RECOVERY_LOOKUP_INCOMPLETE:PAGE_LIMIT_REACHED');
  }
  const activeCustomers = customers.filter((customer) => !customer.deleted);
  const matching = activeCustomers.filter((customer) => normalizeDigits(customer.cpfCnpj) === expectedDocument);
  if (activeCustomers.some((customer) => normalizeDigits(customer.cpfCnpj) !== expectedDocument)) {
    throw new AmbiguousAsaasCustomerMatchesError();
  }

  if (matching.length > 1) throw new AmbiguousAsaasCustomerMatchesError();
  return matching[0] ?? null;
}
