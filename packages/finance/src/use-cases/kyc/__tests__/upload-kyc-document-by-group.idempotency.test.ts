import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockGetMyAccountDocuments,
  mockUploadMyAccountDocument,
  mockLoadCreds,
  mockCreateAsaasAccount,
  mockGetKycSummary,
  mockPrisma,
} = vi.hoisted(() => {
  return {
    mockGetMyAccountDocuments: vi.fn(),
    mockUploadMyAccountDocument: vi.fn(),
    mockLoadCreds: vi.fn(),
    mockCreateAsaasAccount: vi.fn(),
    mockGetKycSummary: vi.fn(),
    mockPrisma: {
      asaasAccount: {
        findFirst: vi.fn(async () => ({ id: 'aa_1', provisionedAt: new Date(Date.now() - 60_000) })),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(async () => ({ id: 'aa_1' })),
      },
      kycProcess: {
        findFirst: vi.fn(async () => null),
      },
      conta: {
        update: vi.fn(async () => ({ id: 'conta_1' })),
      },
      financeProfile: {
        // usado pelo createAsaasAccount mockado (se chamar), mas mantemos aqui por segurança
        findUnique: vi.fn(async () => ({ id: 'fp_1', contaId: 'conta_1' })),
      },
      $transaction: vi.fn(async (ops: unknown[]) => ops),
    },
  };
});

vi.mock('@alusa/asaas', () => ({
  getMyAccountDocuments: mockGetMyAccountDocuments,
  uploadMyAccountDocument: mockUploadMyAccountDocument,
}));

vi.mock('@alusa/database', () => ({
  loadAsaasCredentials: mockLoadCreds,
  prisma: mockPrisma,
}));

vi.mock('../../asaas-account/create-asaas-account', () => ({
  createAsaasAccount: mockCreateAsaasAccount,
}));

vi.mock('../get-kyc-summary', () => ({
  getKycSummary: mockGetKycSummary,
}));

vi.mock('../../../foundation/audit-log.service', () => ({
  auditLogService: { record: vi.fn() },
}));

import { uploadKycDocumentByGroup } from '../upload-kyc-document-by-group';

describe('uploadKycDocumentByGroup (idempotency)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateAsaasAccount.mockResolvedValue({ created: false });
    mockLoadCreds.mockResolvedValue({ apiKey: '$aact_test', accountId: 'acc_1' });
    mockGetKycSummary.mockResolvedValue({ documents: null, snapshot: null } as never);
  });

  it('não reenvia quando grupo está PENDING e já existe documento PENDING do mesmo tipo', async () => {
    mockGetMyAccountDocuments.mockResolvedValue({
      data: [
        {
          id: 'grp_1',
          status: 'PENDING',
          title: 'Documento',
          description: 'Envie um documento',
          documents: [{ id: 'doc_1', type: 'IDENTIFICATION', status: 'PENDING' }],
        },
      ],
    });

    const result = await uploadKycDocumentByGroup({
      contaId: 'conta_1',
      groupId: 'grp_1',
      type: 'IDENTIFICATION',
      file: {
        bytes: new Uint8Array([1, 2, 3]),
        filename: 'doc.pdf',
        mimeType: 'application/pdf',
      },
      actor: { type: 'USER', id: 'u1' },
    });

    expect(mockUploadMyAccountDocument).not.toHaveBeenCalled();
    expect(result.updatedOnboardingStatus).toBe('UNDER_REVIEW');
  });
});
