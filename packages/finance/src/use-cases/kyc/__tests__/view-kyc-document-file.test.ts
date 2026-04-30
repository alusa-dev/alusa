import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@alusa/asaas', () => ({
  getMyAccountDocumentFile: vi.fn(),
  getMyAccountDocuments: vi.fn(),
}));

vi.mock('@alusa/database', () => ({
  loadAsaasCredentials: vi.fn(),
}));

import { getMyAccountDocumentFile, getMyAccountDocuments } from '@alusa/asaas';
import { loadAsaasCredentials } from '@alusa/database';
import { viewKycDocumentFile } from '../view-kyc-document-file';

describe('viewKycDocumentFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna status do documento quando credenciais existem', async () => {
    vi.mocked(loadAsaasCredentials).mockResolvedValue({ apiKey: 'test-api-key' } as never);
    vi.mocked(getMyAccountDocuments).mockResolvedValue({
      data: [{ id: 'g1', status: 'PENDING', documents: [{ id: 'doc_123', status: 'PENDING' }] }],
    } as never);
    vi.mocked(getMyAccountDocumentFile).mockResolvedValue({
      id: 'doc_123',
      status: 'PENDING',
    });

    const result = await viewKycDocumentFile({ contaId: 'conta_1', fileId: 'doc_123' });

    expect(result).toEqual({ id: 'doc_123', status: 'PENDING' });
    expect(loadAsaasCredentials).toHaveBeenCalledWith('conta_1');
    expect(getMyAccountDocuments).toHaveBeenCalledWith({ apiKey: 'test-api-key' });
    expect(getMyAccountDocumentFile).toHaveBeenCalledWith({
      apiKey: 'test-api-key',
      documentId: 'doc_123',
    });
  });

  it('lança erro quando credenciais não existem', async () => {
    vi.mocked(loadAsaasCredentials).mockResolvedValue(null);

    await expect(viewKycDocumentFile({ contaId: 'conta_1', fileId: 'doc_123' }))
      .rejects.toThrow('Credenciais Asaas não encontradas para o tenant');
  });

  it('lança erro quando fileId não pertence à conta', async () => {
    vi.mocked(loadAsaasCredentials).mockResolvedValue({ apiKey: 'test-api-key' } as never);
    vi.mocked(getMyAccountDocuments).mockResolvedValue({
      data: [{ id: 'g1', status: 'PENDING', documents: [{ id: 'doc_other', status: 'PENDING' }] }],
    } as never);

    await expect(viewKycDocumentFile({ contaId: 'conta_1', fileId: 'doc_123' }))
      .rejects.toThrow('Arquivo de documento não encontrado para esta conta');
  });
});
