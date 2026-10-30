import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invitation: {
    id: 'school-invite-1', schoolName: 'Escola Aurora', contactName: 'Ana Souza', email: 'ana@escola.test',
    conditionType: 'STANDARD', planCode: 'BAND_001_025', studentCount: 20, trialDays: 7,
    expiresAt: new Date(Date.now() + 60_000), status: 'PENDING', acceptedContaId: null,
  } as Record<string, unknown> | null,
  findInvitation: vi.fn(),
  createFirstUser: vi.fn(),
  verifyEmail: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock('@alusa/database', () => ({ prisma: { platformSchoolInvitation: { findUnique: mocks.findInvitation } } }));
vi.mock('@/lib/first-user-service', () => ({
  createFirstUser: mocks.createFirstUser,
  findSchoolInvitationByToken: async () => mocks.findInvitation(),
  findAcceptedSchoolInvitationByToken: async () => mocks.invitation ? { status: mocks.invitation.status, email: mocks.invitation.email } : null,
  EmailInUseError: class EmailInUseError extends Error {},
  SchoolInvitationEmailMismatchError: class SchoolInvitationEmailMismatchError extends Error {},
  SchoolInvitationInvalidError: class SchoolInvitationInvalidError extends Error {},
}));
vi.mock('@/lib/auth-email-flow', () => ({ sendEmailVerificationForUser: mocks.verifyEmail }));
vi.mock('@/lib/rate-limit', () => ({
  ipFromRequest: () => '127.0.0.1', rateLimitSubject: async (value: string) => value,
  strictRateLimitAsync: mocks.rateLimit,
}));
vi.mock('@/lib/privacy/evidence', () => ({ requestEvidence: () => ({ ipHash: 'ip-hash', userAgentHash: 'agent-hash' }) }));
vi.mock('@/lib/observability/api-logger', () => ({ getRequestId: () => 'request-1', logApiOperationalEvent: vi.fn() }));

describe('public commercial school invitation acceptance', () => {
  beforeEach(() => {
    mocks.invitation = {
      id: 'school-invite-1', schoolName: 'Escola Aurora', contactName: 'Ana Souza', email: 'ana@escola.test',
      conditionType: 'STANDARD', planCode: 'BAND_001_025', studentCount: 20, trialDays: 7,
      expiresAt: new Date(Date.now() + 60_000), status: 'PENDING', acceptedContaId: null,
    };
    mocks.findInvitation.mockReset().mockImplementation(async () => mocks.invitation);
    mocks.createFirstUser.mockReset().mockResolvedValue({ id: 'user-1', email: 'ana@escola.test' });
    mocks.verifyEmail.mockReset().mockResolvedValue(undefined);
    mocks.rateLimit.mockReset().mockResolvedValue({ ok: true, source: 'redis' });
  });

  it('uses invitation-owned identity and locks the financial mode on the server', async () => {
    const { POST } = await import('@/app/api/public/school-invitations/[token]/route');
    const { requiredRegisterLegalDocuments } = await import('@/lib/privacy/legal-versions');
    const request = new Request('http://localhost/api/public/school-invitations/token', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'attacker@other.test', escolaNome: 'Tenant Spoof', nome: 'Spoof', financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT',
        firstName: '  Maria ', lastName: ' Oliveira  ', senha: 'SenhaFort3!', confirmacaoSenha: 'SenhaFort3!', acceptLegal: true,
        legalAcceptance: { accepted: true, source: 'REGISTER', locale: 'pt-BR', documents: requiredRegisterLegalDocuments().map((item) => ({ documentType: item.type, documentVersion: item.version })) },
      }),
    });
    const response = await POST(request, { params: Promise.resolve({ token: 'a'.repeat(32) }) });
    expect(response.status).toBe(201);
    expect(mocks.createFirstUser).toHaveBeenCalledWith(expect.objectContaining({
      escolaNome: 'Escola Aurora', nome: 'Maria Oliveira', email: 'ana@escola.test',
      financeIntegrationMode: 'WHITELABEL_BAAS', schoolInvitationToken: 'a'.repeat(32),
    }));
    expect(mocks.verifyEmail).toHaveBeenCalledWith('user-1', expect.any(Object), { callbackUrl: '/finance/wizard' });
  });

  it('requires first name and last name', async () => {
    const { POST } = await import('@/app/api/public/school-invitations/[token]/route');
    const { requiredRegisterLegalDocuments } = await import('@/lib/privacy/legal-versions');
    const response = await POST(new Request('http://localhost/api/public/school-invitations/token', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ senha: 'SenhaFort3!', confirmacaoSenha: 'SenhaFort3!', acceptLegal: true,
        legalAcceptance: { accepted: true, source: 'REGISTER', locale: 'pt-BR', documents: requiredRegisterLegalDocuments().map((item) => ({ documentType: item.type, documentVersion: item.version })) } }),
    }), { params: Promise.resolve({ token: 'a'.repeat(32) }) });
    expect(response.status).toBe(400);
    expect(mocks.createFirstUser).not.toHaveBeenCalled();
  });

  it('rejects mismatched password confirmation', async () => {
    const { POST } = await import('@/app/api/public/school-invitations/[token]/route');
    const { requiredRegisterLegalDocuments } = await import('@/lib/privacy/legal-versions');
    const response = await POST(new Request('http://localhost/api/public/school-invitations/token', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ firstName: 'Ana', lastName: 'Souza', senha: 'SenhaFort3!', confirmacaoSenha: 'OutraSenha4!', acceptLegal: true,
        legalAcceptance: { accepted: true, source: 'REGISTER', locale: 'pt-BR', documents: requiredRegisterLegalDocuments().map((item) => ({ documentType: item.type, documentVersion: item.version })) } }),
    }), { params: Promise.resolve({ token: 'a'.repeat(32) }) });
    expect(response.status).toBe(400);
    expect(mocks.createFirstUser).not.toHaveBeenCalled();
  });

  it('requires explicit current legal acceptance on the server', async () => {
    const { POST } = await import('@/app/api/public/school-invitations/[token]/route');
    const response = await POST(new Request('http://localhost/api/public/school-invitations/token', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ senha: 'SenhaFort3!', acceptLegal: false }),
    }), { params: Promise.resolve({ token: 'a'.repeat(32) }) });
    expect(response.status).toBe(400);
    expect(mocks.createFirstUser).not.toHaveBeenCalled();
  });

  it('returns confirmed acceptance on retry without creating a second tenant', async () => {
    mocks.invitation = { ...mocks.invitation, status: 'ACCEPTED', acceptedContaId: 'conta-1' };
    const { POST } = await import('@/app/api/public/school-invitations/[token]/route');
    const response = await POST(new Request('http://localhost/api/public/school-invitations/token', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ senha: 'SenhaFort3!', acceptLegal: true }),
    }), { params: Promise.resolve({ token: 'a'.repeat(32) }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { status: 'ACCEPTED', email: 'ana@escola.test' } });
    expect(mocks.createFirstUser).not.toHaveBeenCalled();
  });
});
