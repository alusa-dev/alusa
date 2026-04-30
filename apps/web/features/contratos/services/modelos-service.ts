import {
  contratoModeloDTOSchema,
  createContratoModeloInputDTOSchema,
  deleteContratoModeloResultDTOSchema,
  listContratoModelosResultDTOSchema,
  updateContratoModeloInputDTOSchema,
  uploadContratoArquivoResultDTOSchema,
  type ContratoModeloDTO,
  type CreateContratoModeloInputDTO,
  type UpdateContratoModeloInputDTO,
  type UploadContratoArquivoResultDTO,
} from '../dtos';
export {
  createContrato,
  getContrato,
  getContratos,
  type Contrato,
  type CreateContratoPayload,
} from './contratos-service';

export type ContratoModelo = ContratoModeloDTO;
export type CreateContratoModeloPayload = CreateContratoModeloInputDTO;
export type UpdateContratoModeloPayload = UpdateContratoModeloInputDTO;
export type UploadContratoResult = UploadContratoArquivoResultDTO;

async function parseResponse<T>(res: Response, parser: { parse: (_value: unknown) => T }, fallback: string) {
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (json as { error?: { message?: string } } | null)?.error?.message || fallback,
    );
  }
  return parser.parse(json);
}

export async function getContratoModelos(activeOnly = false): Promise<ContratoModelo[]> {
  const url = activeOnly ? '/api/contratos/modelos?status=ATIVO' : '/api/contratos/modelos';
  const res = await fetch(url);
  return parseResponse(res, listContratoModelosResultDTOSchema, 'Erro ao carregar modelos de contrato');
}

export async function getContratoModelo(id: string): Promise<ContratoModelo> {
  const res = await fetch(`/api/contratos/modelos/${id}`);
  return parseResponse(res, contratoModeloDTOSchema, 'Erro ao carregar modelo de contrato');
}

export async function createContratoModelo(
  payload: CreateContratoModeloPayload,
): Promise<ContratoModelo> {
  const body = createContratoModeloInputDTOSchema.parse(payload);
  const res = await fetch('/api/contratos/modelos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return parseResponse(res, contratoModeloDTOSchema, 'Erro ao criar modelo de contrato');
}

export async function updateContratoModelo(
  id: string,
  payload: UpdateContratoModeloPayload,
): Promise<ContratoModelo> {
  const body = updateContratoModeloInputDTOSchema.parse(payload);
  const res = await fetch(`/api/contratos/modelos/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return parseResponse(res, contratoModeloDTOSchema, 'Erro ao atualizar modelo');
}

export async function deleteContratoModelo(id: string): Promise<void> {
  const res = await fetch(`/api/contratos/modelos/${id}`, {
    method: 'DELETE',
  });

  await parseResponse(res, deleteContratoModeloResultDTOSchema, 'Erro ao excluir modelo');
}

export async function uploadContratoArquivo(
  file: File,
  onProgress?: (_progress: number) => void,
): Promise<UploadContratoResult> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch('/api/contratos/upload', {
    method: 'POST',
    body: formData,
  });

  onProgress?.(100);
  return parseResponse(res, uploadContratoArquivoResultDTOSchema, 'Erro ao fazer upload do arquivo');
}
