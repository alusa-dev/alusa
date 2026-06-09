/**
 * Testes para proteção de slot APPROVED no upload de documentos KYC.
 * Garante que documentos já aprovados não sejam sobrescritos.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockGetMyAccountDocuments,
  mockGetMyAccountStatus,
  mockUploadMyAccountDocument,
  mockLoadCreds,
  mockPrisma,
  mockGetKycSnapshot,
} = vi.hoisted(() => {
  const mockGetDocs = vi.fn();
  const mockGetStatus = vi.fn();
  const mockUpload = vi.fn();
  const mockCreds = vi.fn();
  const mockGetSnapshot = vi.fn().mockResolvedValue(null);
  return {
    mockGetMyAccountDocuments: mockGetDocs,
    mockGetMyAccountStatus: mockGetStatus,
    mockUploadMyAccountDocument: mockUpload,
    mockLoadCreds: mockCreds,
    mockPrisma: {
      asaasAccount: {
        findFirst: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({ id: 'acc-1' }),
      },
      kycProcess: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      kycSlot: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      conta: {
        update: vi.fn().mockResolvedValue({ id: 'conta-1' }),
      },
      auditLog: { create: vi.fn() },
      $transaction: vi.fn(async (ops: unknown[]) => ops),
    },
    mockGetKycSnapshot: mockGetSnapshot,
  };
});

vi.mock('@alusa/asaas', () => ({
  getMyAccountDocuments: mockGetMyAccountDocuments,
  getMyAccountStatus: mockGetMyAccountStatus,
  uploadMyAccountDocument: mockUploadMyAccountDocument,
}));

vi.mock('@alusa/database', () => ({
  loadAsaasCredentials: mockLoadCreds,
  prisma: mockPrisma,
}));

vi.mock('../get-kyc-snapshot', () => ({
  getKycSnapshotByContaId: mockGetKycSnapshot,
}));

vi.mock('../kyc-asaas-read-cache', () => ({
  getMyAccountDocumentsCached: vi.fn(async (params: { apiKey: string }) => mockGetMyAccountDocuments(params)),
  getMyAccountStatusCached: vi.fn(async (params: { apiKey: string }) => mockGetMyAccountStatus(params)),
}));

vi.mock('../get-kyc-summary', () => ({
  getKycSummary: vi.fn(async () => {
    let myAccountStatus = null;
    try {
      myAccountStatus = await mockGetMyAccountStatus({ apiKey: 'key-1' });
    } catch {
      myAccountStatus = null;
    }
    return {
      onboarding: { status: 'UNDER_REVIEW' },
      asaasConnection: { status: 'CONNECTED' },
      myAccountStatus,
      documents: null,
      documentsRequired: false,
    };
  }),
}));

vi.mock('../../../foundation/audit-log.service', () => ({
  auditLogService: { record: vi.fn() },
}));

vi.mock('../../asaas-account/create-asaas-account', () => ({
  createAsaasAccount: vi.fn().mockResolvedValue({ created: false }),
}));

vi.mock('../kyc-cache-utils', () => ({
  buildCacheV2: vi.fn(() => ({})),
}));

vi.mock('../kyc-persistence.service', () => ({
  syncKycModels: vi.fn().mockResolvedValue(undefined),
}));

import { uploadKycDocumentByGroup } from '../upload-kyc-document-by-group';

const VALID_GROUP_ID = '11111111-1111-4111-8111-111111111111';

const FILE = { bytes: new Uint8Array([1, 2, 3]), filename: 'doc.pdf', mimeType: 'application/pdf' };

describe('uploadKycDocumentByGroup — slot protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadCreds.mockResolvedValue({ apiKey: 'key-1' });
    mockGetMyAccountStatus.mockResolvedValue({ general: 'PENDING', documentation: 'PENDING' });
    mockPrisma.asaasAccount.findFirst.mockResolvedValue({
      id: 'acc-1',
      provisionedAt: new Date(Date.now() - 60_000),
    });
  });

  it('deve bloquear upload quando slot do tipo já está APPROVED', async () => {
    mockGetMyAccountDocuments.mockResolvedValue({
      data: [
        {
          id: VALID_GROUP_ID,
          status: 'REJECTED',
          type: 'IDENTIFICATION',
          title: 'Identificação',
          description: '',
          documents: [
            { id: 'doc-1', type: 'IDENTIFICATION', status: 'APPROVED' },
            { id: 'doc-2', type: 'SOCIAL_CONTRACT', status: 'REJECTED' },
          ],
        },
      ],
    });

    await expect(
      uploadKycDocumentByGroup({
        contaId: 'c1',
        groupId: VALID_GROUP_ID,
        type: 'IDENTIFICATION',
        file: FILE,
      }),
    ).rejects.toThrow('Documento já aprovado não pode ser substituído.');

    expect(mockUploadMyAccountDocument).not.toHaveBeenCalled();
  });

  it('deve permitir upload quando slot do tipo está REJECTED', async () => {
    mockGetMyAccountDocuments
      .mockResolvedValueOnce({
        data: [
          {
            id: VALID_GROUP_ID,
            status: 'REJECTED',
            type: 'IDENTIFICATION',
            title: 'Identificação',
            description: '',
            documents: [
              { id: 'doc-1', type: 'IDENTIFICATION', status: 'REJECTED' },
            ],
          },
        ],
      })
      // refresh after upload
      .mockResolvedValueOnce({ data: [] });

    mockUploadMyAccountDocument.mockResolvedValue({ id: 'doc-new', status: 'PENDING' });

    const result = await uploadKycDocumentByGroup({
      contaId: 'c1',
      groupId: VALID_GROUP_ID,
      type: 'IDENTIFICATION',
      file: FILE,
    });

    expect(mockUploadMyAccountDocument).toHaveBeenCalledTimes(1);
    expect(result.updatedOnboardingStatus).toBe('UNDER_REVIEW');
  });

  it('deve permitir upload quando slot não existe (NOT_SENT)', async () => {
    mockGetMyAccountDocuments
      .mockResolvedValueOnce({
        data: [
          {
            id: VALID_GROUP_ID,
            status: 'NOT_SENT',
            type: 'IDENTIFICATION',
            title: 'Identificação',
            description: '',
            documents: [],
          },
        ],
      })
      .mockResolvedValueOnce({ data: [] });

    mockUploadMyAccountDocument.mockResolvedValue({ id: 'doc-new', status: 'PENDING' });

    const result = await uploadKycDocumentByGroup({
      contaId: 'c1',
      groupId: VALID_GROUP_ID,
      type: 'IDENTIFICATION',
      file: FILE,
    });

    expect(mockUploadMyAccountDocument).toHaveBeenCalledTimes(1);
    expect(result.updatedOnboardingStatus).toBe('UNDER_REVIEW');
  });

  it('deve permitir upload de tipo diferente mesmo com outro slot APPROVED no grupo', async () => {
    mockGetMyAccountDocuments
      .mockResolvedValueOnce({
        data: [
          {
            id: VALID_GROUP_ID,
            status: 'REJECTED',
            type: 'SOCIAL_CONTRACT',
            title: 'Contrato Social',
            description: '',
            documents: [
              { id: 'doc-1', type: 'IDENTIFICATION', status: 'APPROVED' },
              { id: 'doc-2', type: 'SOCIAL_CONTRACT', status: 'REJECTED' },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({ data: [] });

    mockUploadMyAccountDocument.mockResolvedValue({ id: 'doc-new', status: 'PENDING' });

    const result = await uploadKycDocumentByGroup({
      contaId: 'c1',
      groupId: VALID_GROUP_ID,
      type: 'SOCIAL_CONTRACT',
      file: FILE,
    });

    expect(mockUploadMyAccountDocument).toHaveBeenCalledTimes(1);
    expect(result.updatedOnboardingStatus).toBe('UNDER_REVIEW');
  });
});

describe('uploadKycDocumentByGroup — post-upload fresh status sourcing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadCreds.mockResolvedValue({ apiKey: 'key-1' });
    mockPrisma.asaasAccount.findFirst.mockResolvedValue({
      id: 'acc-1',
      provisionedAt: new Date(Date.now() - 60_000),
    });
  });

  function setupUploadableDocs() {
    mockGetMyAccountDocuments
      .mockResolvedValueOnce({
        data: [
          { id: VALID_GROUP_ID, status: 'NOT_SENT', type: 'IDENTIFICATION', title: 'ID', description: '', documents: [] },
        ],
      })
      .mockResolvedValueOnce({ data: [] });
    mockUploadMyAccountDocument.mockResolvedValue({ id: 'doc-new', status: 'PENDING' });
  }

  it('deve usar status APPROVED do Asaas quando generalStatus fresh retorna APPROVED', async () => {
    setupUploadableDocs();
    mockGetMyAccountStatus.mockResolvedValue({ general: 'APPROVED', documentation: 'APPROVED' });

    const result = await uploadKycDocumentByGroup({
      contaId: 'c1',
      groupId: VALID_GROUP_ID,
      type: 'IDENTIFICATION',
      file: FILE,
    });

    expect(result.updatedOnboardingStatus).toBe('APPROVED');
    expect(mockGetMyAccountStatus).toHaveBeenCalledWith({ apiKey: 'key-1' });
  });

  it('deve usar status REJECTED do Asaas quando generalStatus fresh retorna REJECTED', async () => {
    setupUploadableDocs();
    mockGetMyAccountStatus.mockResolvedValue({ general: 'REJECTED', documentation: 'REJECTED' });

    const result = await uploadKycDocumentByGroup({
      contaId: 'c1',
      groupId: VALID_GROUP_ID,
      type: 'IDENTIFICATION',
      file: FILE,
    });

    expect(result.updatedOnboardingStatus).toBe('REJECTED');
  });

  it('deve usar UNDER_REVIEW como fallback quando getMyAccountStatus falha', async () => {
    setupUploadableDocs();
    mockGetMyAccountStatus.mockRejectedValue(new Error('network error'));

    const result = await uploadKycDocumentByGroup({
      contaId: 'c1',
      groupId: VALID_GROUP_ID,
      type: 'IDENTIFICATION',
      file: FILE,
    });

    expect(result.updatedOnboardingStatus).toBe('UNDER_REVIEW');
  });

  it('deve passar myAccountStatus para buildCacheV2 quando disponível', async () => {
    const { buildCacheV2 } = await import('../kyc-cache-utils');
    setupUploadableDocs();
    const freshStatus = { general: 'AWAITING_APPROVAL', documentation: 'PENDING' };
    mockGetMyAccountStatus.mockResolvedValue(freshStatus);

    await uploadKycDocumentByGroup({
      contaId: 'c1',
      groupId: VALID_GROUP_ID,
      type: 'IDENTIFICATION',
      file: FILE,
    });

    expect(buildCacheV2).toHaveBeenCalledWith(
      expect.objectContaining({ myAccountStatus: freshStatus }),
    );
  });
});
