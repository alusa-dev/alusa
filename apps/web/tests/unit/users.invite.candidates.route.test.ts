import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveTenantSessionMock, findInviteCandidatesMock } = vi.hoisted(() => ({
  resolveTenantSessionMock: vi.fn(),
  findInviteCandidatesMock: vi.fn(),
}));

vi.mock('@/lib/api/with-tenant-session', () => ({ resolveTenantSession: resolveTenantSessionMock }));
vi.mock('@/src/server/users/invite-scope.service', () => ({
  findInviteCandidatesInConta: findInviteCandidatesMock,
}));

import { GET } from '@/app/api/users/invite/candidates/route';

describe('GET /api/users/invite/candidates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantSessionMock.mockResolvedValue({ ok: true, userId: 'admin-1', contaId: 'school-a', role: 'ADMIN' });
    findInviteCandidatesMock.mockResolvedValue({
      items: [{
        kind: 'EXISTING_RECORD', recordType: 'RESPONSAVEL', recordId: 'responsavel-a',
        name: 'Responsável A', email: null, students: [{ id: 'student-a', name: 'Aluno A' }], accessStatus: 'ACTIVE',
        inviteStatus: 'NONE', canInvite: false,
      }],
      hasMore: false,
    });
  });

  it('uses only the authenticated tenant and returns a minimal candidate DTO', async () => {
    const response = await GET(new Request('http://x/api/users/invite/candidates?recordType=RESPONSAVEL&page=2&limit=10&q=Maria'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(findInviteCandidatesMock).toHaveBeenCalledWith({
      contaId: 'school-a', recordType: 'RESPONSAVEL', page: 2, limit: 10, query: 'Maria',
    });
    expect(json.items[0]).toEqual({
      kind: 'EXISTING_RECORD', recordType: 'RESPONSAVEL', recordId: 'responsavel-a',
      name: 'Responsável A', email: null, students: [{ id: 'student-a', name: 'Aluno A' }], accessStatus: 'ACTIVE',
      inviteStatus: 'NONE', canInvite: false,
    });
    expect(JSON.stringify(json)).not.toContain('cpf');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects unauthenticated access and invalid pagination', async () => {
    resolveTenantSessionMock.mockResolvedValueOnce({ ok: false, reason: 'ACCOUNT_UNAVAILABLE' });
    const unauthenticated = await GET(new Request('http://x/api/users/invite/candidates?recordType=COLABORADOR'));
    expect(unauthenticated.status).toBe(401);

    const invalidPage = await GET(new Request('http://x/api/users/invite/candidates?recordType=COLABORADOR&limit=500'));
    expect(invalidPage.status).toBe(400);
    const tooFar = await GET(new Request('http://x/api/users/invite/candidates?recordType=COLABORADOR&page=1001'));
    expect(tooFar.status).toBe(400);
    expect(findInviteCandidatesMock).not.toHaveBeenCalled();
  });

  it('rejects roles without candidate permission', async () => {
    resolveTenantSessionMock.mockResolvedValueOnce({ ok: true, userId: 'teacher-1', contaId: 'school-a', role: 'PROFESSOR' });
    const response = await GET(new Request('http://x/api/users/invite/candidates?recordType=COLABORADOR'));
    expect(response.status).toBe(403);
    expect(findInviteCandidatesMock).not.toHaveBeenCalled();
  });

  it('limits RECEPCAO candidates to responsible records', async () => {
    resolveTenantSessionMock.mockResolvedValueOnce({ ok: true, userId: 'reception-1', contaId: 'school-a', role: 'RECEPCAO' });
    const response = await GET(new Request('http://x/api/users/invite/candidates?recordType=COLABORADOR'));
    expect(response.status).toBe(403);
    expect(findInviteCandidatesMock).not.toHaveBeenCalled();
  });
});
