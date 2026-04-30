import { describe, it, expect, vi, beforeEach } from 'vitest';

import { POST } from '@/app/api/kyc/documents/[groupId]/upload/route';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@alusa/finance/use-cases/kyc/get-kyc-snapshot', () => ({
  getKycSnapshotByContaId: vi.fn(),
}));

vi.mock('@alusa/finance/use-cases/kyc/upload-kyc-document-by-group', () => ({
  uploadKycDocumentByGroup: vi.fn(),
}));

vi.mock('@alusa/finance/use-cases/kyc/update-kyc-document-file', () => ({
  updateKycDocumentFile: vi.fn(),
}));

const VALID_GROUP_ID = '8d257732-2220-41ec-b695-b6af4a64184d';
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

describe('POST /api/kyc/documents/[groupId]/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejeita ZERO_UUID quando o grupo ainda não está provisionado', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValueOnce({
      user: { id: 'u1', contaId: 'c1', role: 'ADMIN' },
    } as never);

    const formData = new FormData();
    const req = {
      formData: async () => formData,
    } as unknown as Request;

    const res = await POST(req, { params: Promise.resolve({ groupId: ZERO_UUID }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('INVALID_GROUP_ID');
  });

  it('retorna 400 INVALID_GROUP_ID para groupId com caracteres inválidos', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValueOnce({
      user: { id: 'u1', contaId: 'c1', role: 'ADMIN' },
    } as never);

    const req = new Request('http://localhost/api/kyc/documents/abc%20def/upload', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ groupId: 'abc def' }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('INVALID_GROUP_ID');
    expect(body.groupId).toBe('abc def');
  });

  it('retorna 422 TIPO_DOCUMENTO_INVALIDO quando o use-case rejeitar o tipo', async () => {
    const { getServerSession } = await import('next-auth');
    const { getKycSnapshotByContaId } = await import('@alusa/finance/use-cases/kyc/get-kyc-snapshot');
    const { uploadKycDocumentByGroup } = await import('@alusa/finance/use-cases/kyc/upload-kyc-document-by-group');
    const { updateKycDocumentFile } = await import('@alusa/finance/use-cases/kyc/update-kyc-document-file');

    vi.mocked(getServerSession).mockResolvedValueOnce({
      user: { id: 'u1', contaId: 'c1', role: 'ADMIN' },
    } as never);

    vi.mocked(getKycSnapshotByContaId).mockResolvedValueOnce({
      generalStatus: 'PENDING',
      documentationStatus: 'PENDING',
      bankAccountStatus: 'PENDING',
      commercialInfoAreaStatus: 'PENDING',
      processStatus: 'PENDING_DOCUMENTS',
      commercialInfoStatus: null,
      commercialInfoScheduledDate: null,
      hasBlockingPending: true,
      rejectReasons: [],
      fetchedAt: new Date().toISOString(),
      nextActions: [
        {
          kind: 'UPLOAD_DOCUMENT',
          groupId: VALID_GROUP_ID,
          type: 'IDENTIFICATION',
          title: 'Documento',
        },
      ],
    } as never);

    vi.mocked(uploadKycDocumentByGroup).mockRejectedValueOnce(
      new Error('Tipo do documento inválido para este grupo'),
    );
    vi.mocked(updateKycDocumentFile).mockResolvedValueOnce({ id: 'doc_123', status: 'PENDING' } as never);

    const formData = new FormData();
    formData.append('type', 'IDENTIFICATION');
    const documentFile = new File([new Uint8Array([1, 2, 3])], 'doc.pdf', { type: 'application/pdf' });
    Object.defineProperty(documentFile, 'arrayBuffer', {
      value: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    formData.append('documentFile', documentFile);

    const req = {
      formData: async () => formData,
    } as unknown as Request;

    const res = await POST(req, { params: Promise.resolve({ groupId: VALID_GROUP_ID }) });
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error).toBe('TIPO_DOCUMENTO_INVALIDO');
  });

  it('retorna 409 EXTERNAL_REQUIRED quando Asaas exigir onboarding/link', async () => {
    const { getServerSession } = await import('next-auth');
    const { getKycSnapshotByContaId } = await import('@alusa/finance/use-cases/kyc/get-kyc-snapshot');
    const { uploadKycDocumentByGroup } = await import('@alusa/finance/use-cases/kyc/upload-kyc-document-by-group');
    const { updateKycDocumentFile } = await import('@alusa/finance/use-cases/kyc/update-kyc-document-file');

    vi.mocked(getServerSession).mockResolvedValueOnce({
      user: { id: 'u1', contaId: 'c1', role: 'ADMIN' },
    } as never);

    vi.mocked(getKycSnapshotByContaId).mockResolvedValueOnce({
      generalStatus: 'PENDING',
      documentationStatus: 'PENDING',
      bankAccountStatus: 'PENDING',
      commercialInfoAreaStatus: 'PENDING',
      processStatus: 'PENDING_DOCUMENTS',
      commercialInfoStatus: null,
      commercialInfoScheduledDate: null,
      hasBlockingPending: true,
      rejectReasons: [],
      fetchedAt: new Date().toISOString(),
      nextActions: [
        {
          kind: 'EXTERNAL_ONBOARDING',
          groupId: VALID_GROUP_ID,
          type: 'IDENTIFICATION',
          title: 'Documento',
          onboardingUrl: 'https://example.com/link',
        },
      ],
    } as never);

    // Não deve chamar upload quando o envio é externo
    vi.mocked(uploadKycDocumentByGroup).mockResolvedValueOnce(undefined as never);
    vi.mocked(updateKycDocumentFile).mockResolvedValueOnce({ id: 'doc_123', status: 'PENDING' } as never);

    const formData = new FormData();
    const documentFile = new File([new Uint8Array([1, 2, 3])], 'doc.pdf', { type: 'application/pdf' });
    Object.defineProperty(documentFile, 'arrayBuffer', {
      value: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    formData.append('documentFile', documentFile);

    const req = {
      formData: async () => formData,
    } as unknown as Request;

    const res = await POST(req, { params: Promise.resolve({ groupId: VALID_GROUP_ID }) });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe('EXTERNAL_REQUIRED');
    expect(body.data).toEqual(expect.objectContaining({ actionId: VALID_GROUP_ID }));
  });

  it('retorna 409 PROVIDER_PORTAL_REQUIRED quando a etapa não aceita upload via API', async () => {
    const { getServerSession } = await import('next-auth');
    const { getKycSnapshotByContaId } = await import('@alusa/finance/use-cases/kyc/get-kyc-snapshot');
    const { uploadKycDocumentByGroup } = await import('@alusa/finance/use-cases/kyc/upload-kyc-document-by-group');

    vi.mocked(getServerSession).mockResolvedValueOnce({
      user: { id: 'u1', contaId: 'c1', role: 'ADMIN' },
    } as never);

    vi.mocked(getKycSnapshotByContaId).mockResolvedValueOnce({
      generalStatus: 'PENDING',
      documentationStatus: 'PENDING',
      bankAccountStatus: 'PENDING',
      commercialInfoAreaStatus: 'PENDING',
      processStatus: 'PENDING_DOCUMENTS',
      commercialInfoStatus: null,
      commercialInfoScheduledDate: null,
      hasBlockingPending: true,
      rejectReasons: [],
      fetchedAt: new Date().toISOString(),
      nextActions: [
        {
          kind: 'PROVIDER_PORTAL_REQUIRED',
          groupId: VALID_GROUP_ID,
          type: 'IDENTIFICATION',
          title: 'Documento',
          description: 'Esta etapa precisa ser concluída no ambiente de verificação configurado para a conta.',
        },
      ],
    } as never);

    vi.mocked(uploadKycDocumentByGroup).mockResolvedValueOnce(undefined as never);

    const formData = new FormData();
    const documentFile = new File([new Uint8Array([1, 2, 3])], 'doc.pdf', { type: 'application/pdf' });
    Object.defineProperty(documentFile, 'arrayBuffer', {
      value: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    formData.append('documentFile', documentFile);

    const req = {
      formData: async () => formData,
    } as unknown as Request;

    const res = await POST(req, { params: Promise.resolve({ groupId: VALID_GROUP_ID }) });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe('PROVIDER_PORTAL_REQUIRED');
    expect(body.data).toEqual(expect.objectContaining({ actionId: VALID_GROUP_ID }));
  });

  it('quando slotId é fornecido, atualiza o arquivo (update) e não cria novo por grupo', async () => {
    const { getServerSession } = await import('next-auth');
    const { getKycSnapshotByContaId } = await import('@alusa/finance/use-cases/kyc/get-kyc-snapshot');
    const { uploadKycDocumentByGroup } = await import('@alusa/finance/use-cases/kyc/upload-kyc-document-by-group');
    const { updateKycDocumentFile } = await import('@alusa/finance/use-cases/kyc/update-kyc-document-file');

    vi.mocked(getServerSession).mockResolvedValueOnce({
      user: { id: 'u1', contaId: 'c1', role: 'ADMIN' },
    } as never);

    const slotId = 'doc_123';

    vi.mocked(getKycSnapshotByContaId).mockResolvedValueOnce({
      generalStatus: 'PENDING',
      documentationStatus: 'PENDING',
      bankAccountStatus: 'PENDING',
      commercialInfoAreaStatus: 'PENDING',
      processStatus: 'PENDING_DOCUMENTS',
      commercialInfoStatus: null,
      commercialInfoScheduledDate: null,
      hasBlockingPending: true,
      rejectReasons: [],
      fetchedAt: new Date().toISOString(),
      nextActions: [
        {
          kind: 'UPLOAD_DOCUMENT',
          groupId: VALID_GROUP_ID,
          type: 'IDENTIFICATION',
          title: 'Documento',
          slots: [{ id: slotId, label: 'Frente', status: 'REJECTED' }],
        },
      ],
    } as never);

    vi.mocked(updateKycDocumentFile).mockResolvedValueOnce({ id: slotId, status: 'PENDING' } as never);
    vi.mocked(uploadKycDocumentByGroup).mockResolvedValueOnce(undefined as never);

    const formData = new FormData();
    formData.append('slotId', slotId);
    const documentFile = new File([new Uint8Array([1, 2, 3])], 'doc.pdf', { type: 'application/pdf' });
    Object.defineProperty(documentFile, 'arrayBuffer', {
      value: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    formData.append('documentFile', documentFile);

    const req = {
      formData: async () => formData,
    } as unknown as Request;

    const res = await POST(req, { params: Promise.resolve({ groupId: VALID_GROUP_ID }) });
    expect(res.status).toBe(200);

    expect(updateKycDocumentFile).toHaveBeenCalledWith(
      expect.objectContaining({ contaId: 'c1', fileId: slotId }),
    );
    expect(uploadKycDocumentByGroup).not.toHaveBeenCalled();
  });
});
