/**
 * Configuração de emissão automática de NFS-e em assinaturas.
 *
 * Endpoint oficial: POST /v3/subscriptions/{id}/invoiceSettings
 */
import { AsaasHttp, AsaasHttpError, type AsaasHttpOptions } from '../client/AsaasHttp';

export type SubscriptionInvoiceSettingsTaxesRequest = {
  retainIss: boolean;
  iss: number;
  cofins: number | null;
  csll: number;
  inss: number;
  ir: number;
  pis: number | null;
  nbsCode?: string | null;
  taxSituationCode?: string | null;
  taxClassificationCode?: string | null;
  operationIndicatorCode?: string | null;
  pisCofinsTaxStatus?: string | null;
  operationPis?: number | null;
  operationCofins?: number | null;
  useTaxSystemReformNT007?: boolean;
};

export type SubscriptionInvoiceSettingsTaxesResponse =
  SubscriptionInvoiceSettingsTaxesRequest & {
    pisCofinsRetentionType?: string | null;
    stateIbs?: number | null;
    stateIbsValue?: number | null;
    municipalIbs?: number | null;
    municipalIbsValue?: number | null;
    cbs?: number | null;
    cbsValue?: number | null;
  };

export type UpsertSubscriptionInvoiceSettingsInput = {
  municipalServiceId?: string;
  municipalServiceCode?: string;
  municipalServiceName?: string;
  updatePayment?: boolean;
  deductions?: number;
  effectiveDatePeriod?: string;
  receivedOnly?: boolean;
  daysBeforeDueDate?: number;
  observations?: string;
  taxes?: SubscriptionInvoiceSettingsTaxesRequest;
};

export type SubscriptionInvoiceSettingsResponse = {
  municipalServiceId?: string | null;
  municipalServiceCode?: string | null;
  municipalServiceName?: string | null;
  deductions?: number | null;
  invoiceCreationPeriod?: string | null;
  effectiveDatePeriod?: string | null;
  receivedOnly?: boolean | null;
  daysBeforeDueDate?: number | null;
  observations?: string | null;
  taxes?: SubscriptionInvoiceSettingsTaxesResponse;
};

export type UpsertSubscriptionInvoiceSettingsParams = {
  apiKey: string;
  subscriptionId: string;
  data: UpsertSubscriptionInvoiceSettingsInput;
};

const INVOICE_SETTINGS_NOT_FOUND_OPTIONS: AsaasHttpOptions = {
  expectedErrorStatuses: [404],
};

function invoiceSettingsPath(subscriptionId: string): string {
  return `/subscriptions/${subscriptionId}/invoiceSettings`;
}

export async function upsertSubscriptionInvoiceSettings(
  params: UpsertSubscriptionInvoiceSettingsParams,
): Promise<SubscriptionInvoiceSettingsResponse> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.post<SubscriptionInvoiceSettingsResponse>(
    invoiceSettingsPath(params.subscriptionId),
    params.data,
  );
}

export type GetSubscriptionInvoiceSettingsParams = {
  apiKey: string;
  subscriptionId: string;
};

export async function getSubscriptionInvoiceSettings(
  params: GetSubscriptionInvoiceSettingsParams,
): Promise<SubscriptionInvoiceSettingsResponse> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.get<SubscriptionInvoiceSettingsResponse>(
    invoiceSettingsPath(params.subscriptionId),
  );
}

/** Retorna null quando a assinatura ainda não possui invoiceSettings (404 esperado). */
export async function findSubscriptionInvoiceSettings(
  params: GetSubscriptionInvoiceSettingsParams,
): Promise<SubscriptionInvoiceSettingsResponse | null> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  try {
    return await client.get<SubscriptionInvoiceSettingsResponse>(
      invoiceSettingsPath(params.subscriptionId),
      INVOICE_SETTINGS_NOT_FOUND_OPTIONS,
    );
  } catch (error) {
    if (error instanceof AsaasHttpError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export type UpdateSubscriptionInvoiceSettingsParams = UpsertSubscriptionInvoiceSettingsParams;

export async function updateSubscriptionInvoiceSettings(
  params: UpdateSubscriptionInvoiceSettingsParams,
): Promise<SubscriptionInvoiceSettingsResponse> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.put<SubscriptionInvoiceSettingsResponse>(
    invoiceSettingsPath(params.subscriptionId),
    params.data,
  );
}

export type DeleteSubscriptionInvoiceSettingsParams = {
  apiKey: string;
  subscriptionId: string;
};

export async function deleteSubscriptionInvoiceSettings(
  params: DeleteSubscriptionInvoiceSettingsParams,
): Promise<SubscriptionInvoiceSettingsResponse> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.delete<SubscriptionInvoiceSettingsResponse>(
    invoiceSettingsPath(params.subscriptionId),
  );
}

/** Remove invoiceSettings quando existir; retorna false se já estava ausente (404 esperado). */
export async function deleteSubscriptionInvoiceSettingsIfConfigured(
  params: DeleteSubscriptionInvoiceSettingsParams,
): Promise<boolean> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  try {
    await client.delete<SubscriptionInvoiceSettingsResponse>(
      invoiceSettingsPath(params.subscriptionId),
      INVOICE_SETTINGS_NOT_FOUND_OPTIONS,
    );
    return true;
  } catch (error) {
    if (error instanceof AsaasHttpError && error.status === 404) {
      return false;
    }
    throw error;
  }
}
