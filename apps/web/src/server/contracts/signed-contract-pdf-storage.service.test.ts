import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  delete: vi.fn(),
  get: vi.fn(),
  isConfigured: vi.fn(),
  put: vi.fn(),
}));

vi.mock('@/lib/r2-storage', () => ({
  deleteStorageObject: mocks.delete,
  getStorageObject: mocks.get,
  isR2Configured: mocks.isConfigured,
  putStorageObject: mocks.put,
}));

import { loadSignedContractPdf, storeSignedContractPdf } from './signed-contract-pdf-storage.service';

const pdfBytes = Buffer.from('%PDF-1.4 signed test document');
const sha256 = createHash('sha256').update(pdfBytes).digest('hex');

describe('signed contract PDF storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isConfigured.mockReturnValue(true);
  });

  it('stores one private PDF object with tenant and contract scoped key and hash metadata', async () => {
    const storageKey = await storeSignedContractPdf({ contaId: 'tenant-1', contractId: 'contract-1', bytes: pdfBytes, sha256 });

    expect(storageKey).toMatch(/^uploads\/contracts\/signed\/tenant-1\/contract-1\/[\w-]+\.pdf$/);
    expect(mocks.put).toHaveBeenCalledTimes(1);
    expect(mocks.put).toHaveBeenCalledWith(expect.objectContaining({
      key: storageKey,
      body: pdfBytes,
      contentType: 'application/pdf',
      contentLength: pdfBytes.byteLength,
      metadata: { sha256 },
    }));
  });

  it('fails closed when private object storage is not configured', async () => {
    mocks.isConfigured.mockReturnValue(false);
    await expect(storeSignedContractPdf({ contaId: 'tenant-1', contractId: 'contract-1', bytes: pdfBytes, sha256 }))
      .rejects.toThrow('SIGNED_PDF_STORAGE_UNAVAILABLE');
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('loads a stored object and checks both the PDF signature and persisted hash', async () => {
    const storageKey = 'uploads/contracts/signed/tenant-1/contract-1/123e4567-e89b-12d3-a456-426614174000.pdf';
    mocks.get.mockResolvedValue({ Body: { transformToByteArray: async () => new Uint8Array(pdfBytes) } });

    await expect(loadSignedContractPdf({ contaId: 'tenant-1', contractId: 'contract-1', storageKey, arquivoUrl: '/legacy', sha256 })).resolves.toEqual(pdfBytes);
    expect(mocks.get).toHaveBeenCalledWith(storageKey);
  });

  it('continues reading a verified legacy base64 document', async () => {
    const arquivoUrl = `data:application/pdf;base64,${pdfBytes.toString('base64')}`;
    await expect(loadSignedContractPdf({ contaId: 'tenant-1', contractId: 'contract-1', storageKey: null, arquivoUrl, sha256 })).resolves.toEqual(pdfBytes);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('rejects tampered content and storage keys outside the signed-document prefix', async () => {
    mocks.get.mockResolvedValue({ Body: { transformToByteArray: async () => new Uint8Array(pdfBytes) } });
    await expect(loadSignedContractPdf({ contaId: 'tenant-1', contractId: 'contract-1', storageKey: 'uploads/other/contract.pdf', arquivoUrl: '', sha256 }))
      .rejects.toThrow('SIGNED_PDF_STORAGE_KEY_INVALID');
    await expect(loadSignedContractPdf({ contaId: 'tenant-1', contractId: 'contract-1', storageKey: null, arquivoUrl: `data:application/pdf;base64,${pdfBytes.toString('base64')}`, sha256: '0'.repeat(64) }))
      .rejects.toThrow('SIGNED_PDF_HASH_MISMATCH');
  });

  it('rejects a key that belongs to another tenant or contract', async () => {
    await expect(loadSignedContractPdf({
      contaId: 'tenant-1',
      contractId: 'contract-1',
      storageKey: 'uploads/contracts/signed/tenant-2/contract-2/123e4567-e89b-12d3-a456-426614174000.pdf',
      arquivoUrl: '',
      sha256: '0'.repeat(64),
    })).rejects.toThrow('SIGNED_PDF_STORAGE_KEY_INVALID');
  });
});
