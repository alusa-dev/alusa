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
import type { AsaasMyAccountDocumentsResponse, MyAccountDocumentType, UploadMyAccountDocumentResponse } from '../types/asaas';
export interface GetMyAccountDocumentsParams {
    apiKey: string;
}
export declare function getMyAccountDocuments(params: GetMyAccountDocumentsParams): Promise<AsaasMyAccountDocumentsResponse>;
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
export declare function uploadMyAccountDocument(params: UploadMyAccountDocumentParams): Promise<UploadMyAccountDocumentResponse>;
export interface UpdateMyAccountDocumentFileParams {
    apiKey: string;
    documentId: string;
    documentFile: {
        bytes: Uint8Array;
        filename: string;
        mimeType: string;
    };
}
export declare function updateMyAccountDocumentFile(params: UpdateMyAccountDocumentFileParams): Promise<UploadMyAccountDocumentResponse>;
export interface DeleteMyAccountDocumentFileParams {
    apiKey: string;
    documentId: string;
}
export declare function deleteMyAccountDocumentFile(params: DeleteMyAccountDocumentFileParams): Promise<{
    deleted: boolean;
    id: string;
}>;
export interface GetMyAccountDocumentFileParams {
    apiKey: string;
    documentId: string;
}
export interface MyAccountDocumentFileResponse {
    id: string;
    status: 'NOT_SENT' | 'PENDING' | 'APPROVED' | 'REJECTED';
}
export declare function getMyAccountDocumentFile(params: GetMyAccountDocumentFileParams): Promise<MyAccountDocumentFileResponse>;
//# sourceMappingURL=getMyAccountDocuments.d.ts.map