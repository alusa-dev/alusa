import { createCustomer, listCustomers, restoreCustomer, updateCustomer } from '@alusa/asaas';
import type { AsaasCustomer } from '@alusa/asaas';
import { loadAsaasCredentials } from '@alusa/database';
import type { Result } from '@alusa/shared';
import { ok, err } from '@alusa/shared';

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

export async function syncAsaasCustomerContact(
  input: SyncAsaasCustomerContactInput,
): Promise<Result<void, string>> {
  try {
    const creds = await loadAsaasCredentials(input.contaId);
    if (!creds) {
      return err('Credenciais Asaas não configuradas');
    }

    await updateCustomer({
      apiKey: creds.apiKey,
      customerId: input.customerId,
      data: {
        name: input.name,
        email: input.email,
        ...buildCustomerPhonePayload(input.phone),
        externalReference: input.externalReference,
        notificationDisabled: false,
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
  try {
    const creds = await loadAsaasCredentials(input.contaId);
    if (!creds) {
      return err('Credenciais Asaas não configuradas');
    }

    const byCpfCnpj = await listCustomers({
      apiKey: creds.apiKey,
      cpfCnpj: input.cpfCnpj,
      limit: 10,
    });

    const existingByCpf = findReusableCustomerByDocument(byCpfCnpj.data, input.cpfCnpj);
    if (existingByCpf?.id) {
      const customerId = existingByCpf.id;
      if (existingByCpf.deleted) {
        await restoreCustomer({ apiKey: creds.apiKey, customerId });
      }
      await syncAsaasCustomerContact({
        ...input,
        customerId,
      });
      return ok({
        id: customerId,
        externalReference: existingByCpf.externalReference ?? input.externalReference,
      });
    }

    const byExternal = await listCustomers({
      apiKey: creds.apiKey,
      externalReference: input.externalReference,
      limit: 10,
    });

    const existingByExternal = findReusableCustomerByDocument(byExternal.data, input.cpfCnpj);
    if (existingByExternal?.id) {
      const customerId = existingByExternal.id;
      if (existingByExternal.deleted) {
        await restoreCustomer({ apiKey: creds.apiKey, customerId });
      }
      await syncAsaasCustomerContact({
        ...input,
        customerId,
      });
      return ok({
        id: customerId,
        externalReference: existingByExternal.externalReference ?? input.externalReference,
      });
    }

    const customer = await createCustomer({
      apiKey: creds.apiKey,
      idempotencyKey: input.externalReference,
      data: {
        name: input.name,
        cpfCnpj: input.cpfCnpj,
        email: input.email,
        ...buildCustomerPhonePayload(input.phone),
        externalReference: input.externalReference,
        notificationDisabled: false,
      },
    });

    return ok({ id: customer.id, externalReference: customer.externalReference! });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao criar customer';
    return err(message);
  }
}
