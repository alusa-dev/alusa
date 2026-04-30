import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@alusa/asaas', () => ({
  deleteMyAccountDocumentFile: vi.fn(),
  getMyAccountDocuments: vi.fn(),
}));

vi.mock('@alusa/database', () => ({
  loadAsaasCredentials: vi.fn(),
  prisma: {
    asaasAccount: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    kycProcess: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock('../../../foundation/audit-log.service', () => ({
  auditLogService: {
    record: vi.fn(),
  },
}));

import { deleteMyAccountDocumentFile, getMyAccountDocuments } from '@alusa/asaas';
import { loadAsaasCredentials, prisma } from '@alusa/database';
import { deleteKycDocumentFile } from '../delete-kyc-document-file';
import { auditLogService } from '../../../foundation/audit-log.service';

describe('deleteKycDocumentFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('remove documento e atualiza cache', async () => {
    vi.mocked(loadAsaasCredentials).mockResolvedValue({ apiKey: 'test-api-key' } as never);
    vi.mocked(deleteMyAccountDocumentFile).mockResolvedValue({ deleted: true, id: 'doc_123' });
    vi.mocked(prisma.asaasAccount.findFirst).mockResolvedValue({ id: 'acc_1' } as never);
    vi.mocked(getMyAccountDocuments).mockResolvedValue({
      data: [{ id: 'g1', status: 'PENDING', documents: [{ id: 'doc_123', status: 'PENDING' }] }],
    } as never);
    vi.mocked(prisma.asaasAccount.update).mockResolvedValue({} as never);
    vi.mocked(auditLogService.record).mockResolvedValue(undefined);

    const result = await deleteKycDocumentFile({
      contaId: 'conta_1',
      fileId: 'doc_123',
      actor: { type: 'USER', id: 'user_1' },
    });

    expect(result).toEqual({ deleted: true, id: 'doc_123' });
    expect(deleteMyAccountDocumentFile).toHaveBeenCalledWith({
      apiKey: 'test-api-key',
      documentId: 'doc_123',
    });
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'finance.kyc.delete_document_file',
      })
    );
  });

  it('lança erro quando credenciais não existem', async () => {
    vi.mocked(loadAsaasCredentials).mockResolvedValue(null);

    await expect(deleteKycDocumentFile({ contaId: 'conta_1', fileId: 'doc_123' }))
      .rejects.toThrow('Credenciais Asaas não encontradas para o tenant');
  });

  it('retorna sucesso idempotente quando fileId não pertence à conta', async () => {
    vi.mocked(loadAsaasCredentials).mockResolvedValue({ apiKey: 'test-api-key' } as never);
    vi.mocked(getMyAccountDocuments).mockResolvedValue({
      data: [{ id: 'g1', status: 'PENDING', documents: [{ id: 'doc_other', status: 'PENDING' }] }],
    } as never);

    const result = await deleteKycDocumentFile({ contaId: 'conta_1', fileId: 'doc_123' });

    expect(result).toEqual({ deleted: true, id: 'doc_123' });
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ noop: true, reason: 'ALREADY_MISSING' }),
      }),
    );
  });
});
