/**
 * MyAccount Documents (KYC)
 *
 * Endpoints (whitelabel.md):
 * - GET /v3/myAccount/documents
 * - POST /v3/myAccount/documents/{groupId} (multipart/form-data)
 * - POST /v3/myAccount/documents/files/{documentId} (multipart/form-data)
 * - DELETE /v3/myAccount/documents/files/{documentId}
 *
 * Observação: sempre no contexto da conta autenticada (apiKey da subconta).
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type {
  AsaasMyAccountDocumentsResponse,
  MyAccountDocumentType,
  UploadMyAccountDocumentResponse,
} from '../types/asaas';

export interface GetMyAccountDocumentsParams {
  apiKey: string;
}

export async function getMyAccountDocuments(
  params: GetMyAccountDocumentsParams,
): Promise<AsaasMyAccountDocumentsResponse> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.get<AsaasMyAccountDocumentsResponse>('/myAccount/documents');
}

export interface UploadMyAccountDocumentParams {
  apiKey: string;
  groupId: string;
  type: MyAccountDocumentType;
  documentFile: {
    bytes: Uint8Array;
    filename: string;
    mimeType: string;
  };
}

export async function uploadMyAccountDocument(
  params: UploadMyAccountDocumentParams,
): Promise<UploadMyAccountDocumentResponse> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  const bytesArrayBuffer = new ArrayBuffer(params.documentFile.bytes.byteLength);
  new Uint8Array(bytesArrayBuffer).set(params.documentFile.bytes);

  const formData = new FormData();
  const blob = new Blob([bytesArrayBuffer], { type: params.documentFile.mimeType });

  formData.append('documentFile', blob, params.documentFile.filename);
  formData.append('type', params.type);

  return client.post<UploadMyAccountDocumentResponse>(`/myAccount/documents/${params.groupId}`, formData);
}

export interface UpdateMyAccountDocumentFileParams {
  apiKey: string;
  documentId: string;
  documentFile: {
    bytes: Uint8Array;
    filename: string;
    mimeType: string;
  };
}

export async function updateMyAccountDocumentFile(
  params: UpdateMyAccountDocumentFileParams,
): Promise<UploadMyAccountDocumentResponse> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  const bytesArrayBuffer = new ArrayBuffer(params.documentFile.bytes.byteLength);
  new Uint8Array(bytesArrayBuffer).set(params.documentFile.bytes);

  const formData = new FormData();
  const blob = new Blob([bytesArrayBuffer], { type: params.documentFile.mimeType });

  formData.append('documentFile', blob, params.documentFile.filename);

  return client.post<UploadMyAccountDocumentResponse>(`/myAccount/documents/files/${params.documentId}`, formData);
}

export interface DeleteMyAccountDocumentFileParams {
  apiKey: string;
  documentId: string;
}

export async function deleteMyAccountDocumentFile(
  params: DeleteMyAccountDocumentFileParams,
): Promise<{ deleted: boolean; id: string }> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.delete<{ deleted: boolean; id: string }>(`/myAccount/documents/files/${params.documentId}`);
}

export interface GetMyAccountDocumentFileParams {
  apiKey: string;
  documentId: string;
}

export interface MyAccountDocumentFileResponse {
  id: string;
  status: 'NOT_SENT' | 'PENDING' | 'APPROVED' | 'REJECTED';
}

export async function getMyAccountDocumentFile(
  params: GetMyAccountDocumentFileParams,
): Promise<MyAccountDocumentFileResponse> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.get<MyAccountDocumentFileResponse>(`/myAccount/documents/files/${params.documentId}`);
}
