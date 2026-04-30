/**
 * Sandbox-only: aprova todas as áreas da conta de uma vez.
 *
 * Endpoint: POST /v3/sandbox/myAccount/approve
 *
 * Só funciona em ambiente sandbox. Em produção retorna 404 ou erro.
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasMyAccountStatus } from '../types/asaas';

export interface ApproveSandboxAccountParams {
  apiKey: string;
}

export async function approveSandboxAccount(
  params: ApproveSandboxAccountParams,
): Promise<AsaasMyAccountStatus> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.post<AsaasMyAccountStatus>('/sandbox/myAccount/approve', {});
}
