/**
 * Antecipações de recebíveis no Asaas.
 *
 * Referência oficial:
 * - GET/POST /v3/anticipations
 * - POST /v3/anticipations/simulate
 * - GET/PUT /v3/anticipations/configurations
 * - GET /v3/anticipations/limits
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type {
  AsaasAnticipation,
  AsaasAnticipationConfiguration,
  AsaasAnticipationLimits,
  AsaasAnticipationListResponse,
  AsaasAnticipationSimulation,
  AsaasAnticipationStatus,
} from '../types/asaas';

export interface ListAnticipationsParams {
  apiKey: string;
  offset?: number;
  limit?: number;
  payment?: string;
  installment?: string;
  status?: AsaasAnticipationStatus;
}

export interface SimulateAnticipationParams {
  apiKey: string;
  payment?: string;
  installment?: string;
}

export interface RequestAnticipationParams {
  apiKey: string;
  payment?: string;
  installment?: string;
  document?: Blob;
  documentFilename?: string;
}

export interface GetAnticipationParams {
  apiKey: string;
  id: string;
}

export interface CancelAnticipationParams {
  apiKey: string;
  id: string;
}

export interface UpdateAnticipationConfigurationParams {
  apiKey: string;
  creditCardAutomaticEnabled: boolean;
}

function assertAnticipationTarget(params: { payment?: string; installment?: string }) {
  if (Boolean(params.payment) === Boolean(params.installment)) {
    throw new Error('Informe exatamente um alvo de antecipação: payment ou installment.');
  }
}

export async function listAnticipations(
  params: ListAnticipationsParams,
): Promise<AsaasAnticipationListResponse> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  return client.get<AsaasAnticipationListResponse>('/anticipations', {
    params: {
      offset: params.offset,
      limit: params.limit,
      payment: params.payment,
      installment: params.installment,
      status: params.status,
    },
  });
}

export async function getAnticipation(params: GetAnticipationParams): Promise<AsaasAnticipation> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.get<AsaasAnticipation>(`/anticipations/${params.id}`);
}

export async function simulateAnticipation(
  params: SimulateAnticipationParams,
): Promise<AsaasAnticipationSimulation> {
  assertAnticipationTarget(params);
  const client = new AsaasHttp({ apiKey: params.apiKey });

  return client.post<AsaasAnticipationSimulation>('/anticipations/simulate', {
    payment: params.payment,
    installment: params.installment,
  });
}

export async function requestAnticipation(
  params: RequestAnticipationParams,
): Promise<AsaasAnticipation> {
  assertAnticipationTarget(params);
  const client = new AsaasHttp({ apiKey: params.apiKey });
  const body = new FormData();

  if (params.payment) body.append('payment', params.payment);
  if (params.installment) body.append('installment', params.installment);
  if (params.document) {
    body.append('documents', params.document, params.documentFilename ?? 'documento.pdf');
  }

  return client.post<AsaasAnticipation>('/anticipations', body);
}

export async function cancelAnticipation(
  params: CancelAnticipationParams,
): Promise<AsaasAnticipation> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.post<AsaasAnticipation>(`/anticipations/${params.id}/cancel`, {});
}

export async function getAnticipationLimits(params: {
  apiKey: string;
}): Promise<AsaasAnticipationLimits> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.get<AsaasAnticipationLimits>('/anticipations/limits');
}

export async function getAnticipationConfiguration(params: {
  apiKey: string;
}): Promise<AsaasAnticipationConfiguration> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.get<AsaasAnticipationConfiguration>('/anticipations/configurations');
}

export async function updateAnticipationConfiguration(
  params: UpdateAnticipationConfigurationParams,
): Promise<AsaasAnticipationConfiguration> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  return client.put<AsaasAnticipationConfiguration>('/anticipations/configurations', {
    creditCardAutomaticEnabled: params.creditCardAutomaticEnabled,
  });
}
