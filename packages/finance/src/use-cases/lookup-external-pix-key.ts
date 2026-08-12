import { AsaasHttpError, getExternalPixKey } from '@alusa/asaas';
import { loadAsaasCredentials } from '@alusa/database';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';

import type { PixKeyType } from './transfers/asaas-transfer-payload';

export type LookupExternalPixKeyInput = { contaId: string; type: PixKeyType; key: string };
export type LookupExternalPixKeyOutput = {
  type: string | null;
  key: string | null;
  institutionName: string | null;
  bankName: string | null;
  bankCode: string | null;
  ownerName: string | null;
  ownerDocumentMasked: string | null;
};
export type LookupExternalPixKeyError =
  | 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
  | 'CHAVE_PIX_NAO_ENCONTRADA'
  | 'CONSULTA_CHAVE_PIX_INDISPONIVEL';

export async function lookupExternalPixKey(
  input: LookupExternalPixKeyInput,
): Promise<Result<LookupExternalPixKeyOutput, LookupExternalPixKeyError>> {
  const credentials = await loadAsaasCredentials(input.contaId);
  if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

  try {
    const response = await getExternalPixKey({ apiKey: credentials.apiKey, type: input.type, key: input.key });
    return ok({
      type: response.type ?? null,
      key: response.key ?? null,
      institutionName: response.financialInstitution?.name ?? response.ispbName ?? null,
      bankName: response.financialInstitution?.bank?.name ?? null,
      bankCode: response.financialInstitution?.bank?.code ?? response.financialInstitution?.code ?? null,
      ownerName: response.owner?.name ?? null,
      ownerDocumentMasked: response.owner?.cpfCnpj ?? null,
    });
  } catch (error) {
    if (error instanceof AsaasHttpError && (error.status === 400 || error.status === 404)) {
      return err('CHAVE_PIX_NAO_ENCONTRADA');
    }
    return err('CONSULTA_CHAVE_PIX_INDISPONIVEL');
  }
}
