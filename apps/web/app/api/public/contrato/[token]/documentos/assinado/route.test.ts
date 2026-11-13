import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ find: vi.fn(), get: vi.fn(), log: vi.fn() }));
vi.mock('@/src/server/contracts/contract-read.service', () => ({ findPublicContractByToken: mocks.find, getSignedContractDocument: mocks.get }));
vi.mock('@/lib/observability/api-logger', () => ({ getRequestId: () => 'request-academic-1', logApiOperationalEvent: mocks.log }));
import { GET } from './route';

const request = () => new NextRequest('http://localhost/api/public/contrato/token-1/documentos/assinado');
const context = (token = 'token-1') => ({ params: Promise.resolve({ token }) });

describe('public signed academic contract PDF', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.find.mockResolvedValue({ id: 'contract-1', contaId: 'account-1', status: 'ASSINADO' });
    mocks.get.mockResolvedValue({ arquivoUrl: 'data:application/pdf;base64,JVBERi0xLjQ=', hashSha256: 'sha256' });
  });

  it('serves signed bytes to an anonymous request scoped to the resolved tenant and contract', async () => {
    const response = await GET(request(), context());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.from([37, 80, 68, 70, 45, 49, 46, 52]));
    expect(mocks.find).toHaveBeenCalledWith('token-1');
    expect(mocks.get).toHaveBeenCalledWith({ contaId: 'account-1', contratoId: 'contract-1' });
  });

  it('returns the same 404 for invalid, not-signed, and unavailable documents', async () => {
    mocks.find.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'contract-1', contaId: 'account-1', status: 'PENDENTE' });
    expect((await GET(request(), context())).status).toBe(404);
    expect((await GET(request(), context())).status).toBe(404);
    mocks.get.mockResolvedValueOnce(null);
    expect((await GET(request(), context())).status).toBe(404);
  });

  it('returns sanitized no-store 503 and logs operational lookup failures', async () => {
    mocks.find.mockRejectedValueOnce(new Error('private database details'));
    const response = await GET(request(), context());
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.text()).toBe('');
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'request-academic-1', error: expect.any(Error) }));
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain('private database details');
  });

  it.each([
    ['empty', 'data:application/pdf;base64,'],
    ['malformed', 'data:application/pdf;base64,aGVsbG8='],
  ])('returns sanitized 503 for a persisted %s PDF', async (_label, arquivoUrl) => {
    mocks.get.mockResolvedValueOnce({ arquivoUrl, hashSha256: 'sha256' });
    const response = await GET(request(), context());
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'request-academic-1' }));
  });
});
