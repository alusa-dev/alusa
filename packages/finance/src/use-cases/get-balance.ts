import { getBalance as asaasGetBalance } from '@alusa/asaas';
import { loadAsaasCredentials } from '@alusa/database';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';

export type GetBalanceError =
  | 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
  | 'ERRO_AO_OBTER_SALDO';

export interface GetBalanceInput {
  contaId: string;
}

export interface GetBalanceOutput {
  balance: number;
}

export async function getBalance(input: GetBalanceInput): Promise<Result<GetBalanceOutput, GetBalanceError>> {
  const credentials = await loadAsaasCredentials(input.contaId);
  if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

  try {
    const data = await asaasGetBalance({
      apiKey: credentials.apiKey,
    });

    return ok({ balance: data.balance });
  } catch {
    return err('ERRO_AO_OBTER_SALDO');
  }
}
