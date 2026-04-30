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
export async function getMyAccountDocuments(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    return client.get('/myAccount/documents');
}
export async function uploadMyAccountDocument(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    const bytesArrayBuffer = new ArrayBuffer(params.documentFile.bytes.byteLength);
    new Uint8Array(bytesArrayBuffer).set(params.documentFile.bytes);
    const formData = new FormData();
    const blob = new Blob([bytesArrayBuffer], { type: params.documentFile.mimeType });
    formData.append('documentFile', blob, params.documentFile.filename);
    formData.append('type', params.type);
    return client.post(`/myAccount/documents/${params.groupId}`, formData);
}
export async function updateMyAccountDocumentFile(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    const bytesArrayBuffer = new ArrayBuffer(params.documentFile.bytes.byteLength);
    new Uint8Array(bytesArrayBuffer).set(params.documentFile.bytes);
    const formData = new FormData();
    const blob = new Blob([bytesArrayBuffer], { type: params.documentFile.mimeType });
    formData.append('documentFile', blob, params.documentFile.filename);
    return client.post(`/myAccount/documents/files/${params.documentId}`, formData);
}
export async function deleteMyAccountDocumentFile(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    return client.delete(`/myAccount/documents/files/${params.documentId}`);
}
export async function getMyAccountDocumentFile(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    return client.get(`/myAccount/documents/files/${params.documentId}`);
}
