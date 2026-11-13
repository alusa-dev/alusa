import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  findPublicContractByToken,
  getStorageObject,
  isR2Configured,
  storageKeyFromUrl,
  logApiOperationalEvent,
} = vi.hoisted(() => ({
  findPublicContractByToken: vi.fn(),
  getStorageObject: vi.fn(),
  isR2Configured: vi.fn(),
  storageKeyFromUrl: vi.fn(),
  logApiOperationalEvent: vi.fn(),
}));
vi.mock('@/src/server/contracts/contract-read.service', () => ({ findPublicContractByToken }));
vi.mock('@/lib/r2-storage', () => ({ getStorageObject, isR2Configured, storageKeyFromUrl }));
vi.mock('@/lib/observability/api-logger', () => ({
  getRequestId: () => 'request-123',
  logApiOperationalEvent,
}));

import { GET } from './route';

const request = () => new NextRequest('http://localhost/api/public/contrato/token-1/document');
const context = (token: unknown = 'token-1') => ({
  params: Promise.resolve({ token }) as Promise<{ token: string }>,
});
const contract = (status = 'PENDENTE') => ({
  id: 'contract-1',
  contaId: 'account-1',
  status,
  arquivoPdfUrl: '/api/files/uploads/contracts/contract-1.pdf',
});
const pdfObject = () => ({
  Body: { transformToByteArray: vi.fn().mockResolvedValue(Uint8Array.from([37, 80, 68, 70])) },
});

describe('GET /api/public/contrato/[token]/document', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isR2Configured.mockReturnValue(true);
    storageKeyFromUrl.mockReturnValue('uploads/contracts/contract-1.pdf');
    findPublicContractByToken.mockResolvedValue(contract());
    getStorageObject.mockResolvedValue(pdfObject());
  });

  it('rejects invalid token params without querying storage', async () => {
    const response = await GET(request(), context(''));
    expect(response.status).toBe(404);
    expect(getStorageObject).not.toHaveBeenCalled();
  });

  it('rejects missing contracts and cancelled contracts without querying storage', async () => {
    findPublicContractByToken
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(contract('CANCELADO'));
    expect((await GET(request(), context())).status).toBe(404);
    expect((await GET(request(), context())).status).toBe(404);
    expect(getStorageObject).not.toHaveBeenCalled();
  });

  it('serves the contract PDF inline with private no-cache headers', async () => {
    const response = await GET(request(), context());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toContain('inline');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.from([37, 80, 68, 70]));
    expect(getStorageObject).toHaveBeenCalledWith('uploads/contracts/contract-1.pdf');
  });

  it('rejects non-storage URLs and storage failures without exposing them', async () => {
    storageKeyFromUrl.mockReturnValueOnce(null);
    expect((await GET(request(), context())).status).toBe(404);
    expect(getStorageObject).not.toHaveBeenCalled();
    getStorageObject.mockRejectedValueOnce(new Error('storage details'));
    const response = await GET(request(), context());
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(logApiOperationalEvent).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'request-123', error: expect.any(Error) }),
    );
    expect(JSON.stringify(logApiOperationalEvent.mock.calls)).not.toContain('storage details');
  });

  it('returns logged 503 responses when R2 or the contract lookup is unavailable', async () => {
    isR2Configured.mockReturnValueOnce(false);
    expect((await GET(request(), context())).status).toBe(503);
    findPublicContractByToken.mockRejectedValueOnce(new TypeError('private db details'));
    const response = await GET(request(), context());
    expect(response.status).toBe(503);
    expect(JSON.stringify(logApiOperationalEvent.mock.calls)).not.toContain('private db details');
  });

  it('returns 404 for an R2 NoSuchKey without logging an infrastructure failure', async () => {
    getStorageObject.mockRejectedValueOnce(Object.assign(new Error('missing'), { name: 'NoSuchKey' }));
    expect((await GET(request(), context())).status).toBe(404);
    expect(logApiOperationalEvent).not.toHaveBeenCalled();
  });
});
