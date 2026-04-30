import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockGetMyAccountDocuments,
  mockDeleteMyAccountDocumentFile,
  mockLoadCreds,
  mockPrisma,
  mockAuditRecord,
} = vi.hoisted(() => {
  return {
    mockGetMyAccountDocuments: vi.fn(),
    mockDeleteMyAccountDocumentFile: vi.fn(),
    mockLoadCreds: vi.fn(),
    mockAuditRecord: vi.fn(),
    mockPrisma: {
      asaasAccount: {
        findFirst: vi.fn(async () => ({ id: 'aa_1' })),
        update: vi.fn(async () => ({ id: 'aa_1' })),
      },
    },
  };
});

vi.mock('@alusa/asaas', () => ({
  getMyAccountDocuments: mockGetMyAccountDocuments,
  deleteMyAccountDocumentFile: mockDeleteMyAccountDocumentFile,
}));

vi.mock('@alusa/database', () => ({
  loadAsaasCredentials: mockLoadCreds,
  prisma: mockPrisma,
}));

vi.mock('../../../foundation/audit-log.service', () => ({
  auditLogService: { record: mockAuditRecord },
}));

import { deleteKycDocumentFile } from '../delete-kyc-document-file';

describe('deleteKycDocumentFile (idempotency)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadCreds.mockResolvedValue({ apiKey: '$aact_test', accountId: 'acc_1' });
  });

  it('retorna deleted=true sem chamar provedor quando arquivo já não existe', async () => {
    mockGetMyAccountDocuments.mockResolvedValue({
      data: [{ id: 'grp_1', status: 'NOT_SENT', documents: [] }],
    });

    const result = await deleteKycDocumentFile({
      contaId: 'conta_1',
      fileId: 'file_missing',
      actor: { type: 'USER', id: 'u1' },
    });

    expect(result).toEqual({ deleted: true, id: 'file_missing' });
    expect(mockDeleteMyAccountDocumentFile).not.toHaveBeenCalled();
    expect(mockAuditRecord).toHaveBeenCalled();
  });
});
