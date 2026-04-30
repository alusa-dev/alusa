import { getMyAccountFees } from '@alusa/asaas';
import { loadAsaasCredentials } from '@alusa/database';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';

export interface GetTransferFeesInput {
  contaId: string;
}

export interface GetTransferFeesOutput {
  monthlyTransfersWithoutFee: number;
  pix: {
    feeValue: number | null;
    discountValue: number | null;
    expirationDate: string | null;
    consideredInMonthlyTransfersWithoutFee: boolean;
  };
  ted: {
    feeValue: number | null;
    consideredInMonthlyTransfersWithoutFee: boolean;
  };
}

export type GetTransferFeesError =
  | 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
  | 'ERRO_AO_OBTER_TARIFAS_TRANSFERENCIA';

export async function getTransferFees(
  input: GetTransferFeesInput,
): Promise<Result<GetTransferFeesOutput, GetTransferFeesError>> {
  const credentials = await loadAsaasCredentials(input.contaId);
  if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

  try {
    const response = await getMyAccountFees({ apiKey: credentials.apiKey });
    return ok({
      monthlyTransfersWithoutFee: response.transfer?.monthlyTransfersWithoutFee ?? 0,
      pix: {
        feeValue: response.transfer?.pix?.feeValue ?? null,
        discountValue: response.transfer?.pix?.discountValue ?? null,
        expirationDate: response.transfer?.pix?.expirationDate ?? null,
        consideredInMonthlyTransfersWithoutFee:
          response.transfer?.pix?.consideredInMonthlyTransfersWithoutFee ?? false,
      },
      ted: {
        feeValue: response.transfer?.ted?.feeValue ?? null,
        consideredInMonthlyTransfersWithoutFee:
          response.transfer?.ted?.consideredInMonthlyTransfersWithoutFee ?? false,
      },
    });
  } catch {
    return err('ERRO_AO_OBTER_TARIFAS_TRANSFERENCIA');
  }
}