import {
  contratoModeloDTOSchema,
  createContratoModeloInputDTOSchema,
  deleteContratoModeloResultDTOSchema,
  listContratoModelosResultDTOSchema,
  listContratoConsentimentoTemplatesResultDTOSchema,
  updateContratoModeloInputDTOSchema,
  uploadContratoArquivoResultDTOSchema,
  type ContratoModeloDTO,
  type ContratoConsentimentoTemplateDTO,
  type CreateContratoModeloInputDTO,
  type UpdateContratoModeloInputDTO,
  type UploadContratoArquivoResultDTO,
} from '../dtos';
export {
  createContract,
  getContract,
  getContracts,
  type Contract,
  type CreateContractPayload,
} from './contracts-service';

export type ContractTemplate = ContratoModeloDTO;
export type CreateContractTemplatePayload = CreateContratoModeloInputDTO;
export type UpdateContractTemplatePayload = UpdateContratoModeloInputDTO;
export type UploadContractFileResult = UploadContratoArquivoResultDTO;
export type ConsentTemplate = ContratoConsentimentoTemplateDTO;

async function parseResponse<T>(res: Response, parser: { parse: (_value: unknown) => T }, fallback: string) {
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const payload = json as {
      error?: { message?: string } | string;
      message?: string;
    } | null;
    const nestedMessage = typeof payload?.error === 'object' ? payload.error?.message : undefined;
    throw new Error(
      nestedMessage || payload?.message || fallback,
    );
  }
  return parser.parse(json);
}

export async function getContractTemplates(activeOnly = false): Promise<ContractTemplate[]> {
  const url = activeOnly ? '/api/contratos/modelos?status=ATIVO' : '/api/contratos/modelos';
  const res = await fetch(url);
  return parseResponse(res, listContratoModelosResultDTOSchema, 'Erro ao carregar modelos de contrato');
}

export async function getContractTemplate(id: string): Promise<ContractTemplate> {
  const res = await fetch(`/api/contratos/modelos/${id}`);
  return parseResponse(res, contratoModeloDTOSchema, 'Erro ao carregar modelo de contrato');
}

export async function getConsentTemplates(): Promise<ConsentTemplate[]> {
  const res = await fetch('/api/contratos/consentimentos/templates', { cache: 'no-store' });
  return parseResponse(
    res,
    listContratoConsentimentoTemplatesResultDTOSchema,
    'Erro ao carregar templates de consentimento',
  );
}

export async function createContractTemplate(
  payload: CreateContractTemplatePayload,
): Promise<ContractTemplate> {
  const body = createContratoModeloInputDTOSchema.parse(payload);
  const res = await fetch('/api/contratos/modelos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return parseResponse(res, contratoModeloDTOSchema, 'Erro ao criar modelo de contrato');
}

export async function updateContractTemplate(
  id: string,
  payload: UpdateContractTemplatePayload,
): Promise<ContractTemplate> {
  const body = updateContratoModeloInputDTOSchema.parse(payload);
  const res = await fetch(`/api/contratos/modelos/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return parseResponse(res, contratoModeloDTOSchema, 'Erro ao atualizar modelo');
}

export async function deleteContractTemplate(id: string): Promise<void> {
  const res = await fetch(`/api/contratos/modelos/${id}`, {
    method: 'DELETE',
  });

  await parseResponse(res, deleteContratoModeloResultDTOSchema, 'Erro ao excluir modelo');
}

export async function uploadContractFile(
  file: File,
  onProgress?: (_progress: number) => void,
): Promise<UploadContractFileResult> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch('/api/contratos/upload', {
    method: 'POST',
    body: formData,
  });

  onProgress?.(100);
  return parseResponse(res, uploadContratoArquivoResultDTOSchema, 'Erro ao fazer upload do arquivo');
}
