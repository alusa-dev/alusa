import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  status: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/lib/auth-options', () => ({ authOptions: {} }));
vi.mock('@/src/server/matriculas/enrollment-creation-status.service', () => ({
  readEnrollmentCreationStatus: mocks.status,
}));

import { GET } from './route';

function request(contaId = 'conta-a') {
  return new Request(`http://localhost/api/matriculas/operacoes/attempt-1?contaId=${contaId}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 'user-a', contaId: 'conta-a', role: 'ADMIN' } });
  mocks.status.mockResolvedValue({ status: 'PROCESSING' });
});

describe('GET /api/matriculas/operacoes/[uiRequestId]', () => {
  it('requires an authenticated tenant session', async () => {
    mocks.session.mockResolvedValue(null);
    const response = await GET(request(), { params: Promise.resolve({ uiRequestId: 'attempt-1' }) });
    expect(response.status).toBe(401);
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it('rejects another tenant or unauthorized role', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'user-a', contaId: 'conta-a', role: 'PROFESSOR' } });
    const response = await GET(request('conta-b'), { params: Promise.resolve({ uiRequestId: 'attempt-1' }) });
    expect(response.status).toBe(403);
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it('returns the read-only operation status scoped to the session tenant', async () => {
    mocks.status.mockResolvedValue({ status: 'COMMITTED', result: { matricula: { id: 'mat-1' } } });
    const response = await GET(request(), { params: Promise.resolve({ uiRequestId: 'attempt-1' }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'COMMITTED', result: { matricula: { id: 'mat-1' } } });
    expect(mocks.status).toHaveBeenCalledWith('conta-a', 'attempt-1');
  });

  it('rejects an invalid operation identifier', async () => {
    const response = await GET(request(), { params: Promise.resolve({ uiRequestId: '   ' }) });
    expect(response.status).toBe(400);
    expect(mocks.status).not.toHaveBeenCalled();
  });
});
