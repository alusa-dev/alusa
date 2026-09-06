import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageMock = vi.hoisted(() => ({
  getStorageObject: vi.fn(),
  isR2Configured: vi.fn(),
  storageKeyFromUrl: vi.fn(),
}));

vi.mock('@/lib/r2-storage', () => storageMock);

import { loadPublicContractPdf } from './load-public-contract-pdf';

describe('loadPublicContractPdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.isR2Configured.mockReturnValue(true);
  });

  it('ignora URLs que não são do storage interno', async () => {
    storageMock.storageKeyFromUrl.mockReturnValue(null);

    await expect(loadPublicContractPdf('https://files.example/contrato.pdf')).resolves.toBeNull();
    expect(storageMock.getStorageObject).not.toHaveBeenCalled();
  });

  it('carrega o PDF diretamente do R2 sem depender da sessão do signatário', async () => {
    storageMock.storageKeyFromUrl.mockReturnValue('uploads/contratos/conta-user-contrato.pdf');
    storageMock.getStorageObject.mockResolvedValue({
      Body: { transformToByteArray: vi.fn().mockResolvedValue(Uint8Array.from([37, 80, 68, 70])) },
    });

    await expect(loadPublicContractPdf('/api/files/uploads/contratos/conta-user-contrato.pdf'))
      .resolves.toEqual(Buffer.from('%PDF'));
    expect(storageMock.getStorageObject).toHaveBeenCalledWith('uploads/contratos/conta-user-contrato.pdf');
  });

  it('retorna nulo quando o objeto não tem conteúdo', async () => {
    storageMock.storageKeyFromUrl.mockReturnValue('uploads/contratos/conta-user-vazio.pdf');
    storageMock.getStorageObject.mockResolvedValue({ Body: undefined });

    await expect(loadPublicContractPdf('/api/files/uploads/contratos/conta-user-vazio.pdf')).resolves.toBeNull();
  });
});
