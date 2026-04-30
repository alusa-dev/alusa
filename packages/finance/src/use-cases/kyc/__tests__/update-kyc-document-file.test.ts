import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@alusa/asaas', () => ({
  updateMyAccountDocumentFile: vi.fn(),
  getMyAccountDocuments: vi.fn(),
}));

vi.mock('@alusa/database', () => ({
  loadAsaasCredentials: vi.fn(),
  prisma: {
    asaasAccount: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../../foundation/audit-log.service', () => ({
  auditLogService: {
    record: vi.fn(),
  },
}));

import { updateMyAccountDocumentFile, getMyAccountDocuments } from '@alusa/asaas';
import { loadAsaasCredentials, prisma } from '@alusa/database';
import { updateKycDocumentFile } from '../update-kyc-document-file';
import { auditLogService } from '../../../foundation/audit-log.service';

describe('updateKycDocumentFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('atualiza documento e registra auditoria', async () => {
    vi.mocked(loadAsaasCredentials).mockResolvedValue({ apiKey: 'test-api-key' } as never);
    vi.mocked(updateMyAccountDocumentFile).mockResolvedValue({ id: 'doc_123', status: 'PENDING' });
    vi.mocked(prisma.asaasAccount.findFirst).mockResolvedValue({ id: 'acc_1' } as never);
    vi.mocked(getMyAccountDocuments).mockResolvedValue({
      data: [{ id: 'g1', status: 'PENDING', documents: [{ id: 'doc_123', status: 'PENDING' }] }],
    } as never);
    vi.mocked(prisma.asaasAccount.update).mockResolvedValue({} as never);
    vi.mocked(auditLogService.record).mockResolvedValue(undefined);

    const result = await updateKycDocumentFile({
      contaId: 'conta_1',
      fileId: 'doc_123',
      file: {
        bytes: new Uint8Array([1, 2, 3]),
        filename: 'test.pdf',
        mimeType: 'application/pdf',
      },
      actor: { type: 'USER', id: 'user_1' },
    });

    expect(result).toEqual({ id: 'doc_123', status: 'PENDING' });
    expect(updateMyAccountDocumentFile).toHaveBeenCalledWith({
      apiKey: 'test-api-key',
      documentId: 'doc_123',
      documentFile: {
        bytes: new Uint8Array([1, 2, 3]),
        filename: 'test.pdf',
        mimeType: 'application/pdf',
      },
    });
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'finance.kyc.update_document_file',
      })
    );
  });

  it('lança erro quando credenciais não existem', async () => {
    vi.mocked(loadAsaasCredentials).mockResolvedValue(null);

    await expect(
      updateKycDocumentFile({
        contaId: 'conta_1',
        fileId: 'doc_123',
        file: { bytes: new Uint8Array([1]), filename: 'test.pdf', mimeType: 'application/pdf' },
      })
    ).rejects.toThrow('Credenciais Asaas não encontradas para o tenant');
  });

  it('lança erro quando fileId não pertence à conta', async () => {
    vi.mocked(loadAsaasCredentials).mockResolvedValue({ apiKey: 'test-api-key' } as never);
    vi.mocked(getMyAccountDocuments).mockResolvedValue({
      data: [{ id: 'g1', status: 'PENDING', documents: [{ id: 'doc_other', status: 'PENDING' }] }],
    } as never);

    await expect(
      updateKycDocumentFile({
        contaId: 'conta_1',
        fileId: 'doc_123',
        file: { bytes: new Uint8Array([1]), filename: 'test.pdf', mimeType: 'application/pdf' },
      }),
    ).rejects.toThrow('Arquivo de documento não encontrado para esta conta');
  });
});
