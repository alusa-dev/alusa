import { z } from 'zod';
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

export const CONTRACT_INLINE_UPLOAD_MAX_BYTES = 3 * 1024 * 1024;

export function shouldUploadContractDirectly(size: number): boolean {
  return size > CONTRACT_INLINE_UPLOAD_MAX_BYTES;
}

const presignUploadResponseSchema = z.object({
  uploadUrl: z.string().url(),
  reservationId: z.string().uuid(),
  requiredHeaders: z.record(z.string()),
  expectedContentLength: z.number().int().positive(),
});
const completedUploadResponseSchema = z.object({
  url: z.string(),
  size: z.number().int().nonnegative(),
  type: z.string(),
  hashSha256: z.string().length(64),
});

export function putFileWithXhr(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress?: (_progress: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [name, value] of Object.entries(headers)) {
      // Browsers forbid callers from setting Content-Length; XHR derives it from the File body.
      if (name.toLowerCase() !== 'content-length') xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(Math.min(95, Math.round((event.loaded / event.total) * 95)));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error('O armazenamento recusou o arquivo. Confira o tipo e tente novamente.'));
    };
    xhr.onerror = () => reject(new Error('Não foi possível enviar o arquivo ao armazenamento.'));
    xhr.onabort = () => reject(new Error('Envio do arquivo cancelado.'));
    xhr.send(file);
  });
}

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
  if (shouldUploadContractDirectly(file.size)) {
    const presignResponse = await fetch('/api/upload/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ size: file.size, contentType: file.type }),
    });
    const presign = await parseResponse(
      presignResponse,
      presignUploadResponseSchema,
      'Não foi possível preparar o upload do arquivo',
    );
    if (presign.expectedContentLength !== file.size) throw new Error('O tamanho reservado para o arquivo não confere.');
    await putFileWithXhr(presign.uploadUrl, file, presign.requiredHeaders, onProgress);
    const complete = await fetch('/api/upload/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reservationId: presign.reservationId }),
    });
    const finalized = await parseResponse(
      complete,
      completedUploadResponseSchema,
      'Não foi possível confirmar o arquivo enviado',
    );
    onProgress?.(100);
    return uploadContratoArquivoResultDTOSchema.parse({
      url: finalized.url,
      hashSha256: finalized.hashSha256,
      size: finalized.size,
      mimeType: finalized.type,
    });
  }

  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch('/api/contratos/upload', {
    method: 'POST',
    body: formData,
  });

  onProgress?.(100);
  return parseResponse(res, uploadContratoArquivoResultDTOSchema, 'Erro ao fazer upload do arquivo');
}
