import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, requireSupport, recordAccess, findReusable, createUseCase } = vi.hoisted(() => ({
  prismaMock: {},
  requireSupport: vi.fn(),
  recordAccess: vi.fn(),
  findReusable: vi.fn(),
  createUseCase: vi.fn(),
}));

vi.mock('@alusa/database', () => ({ prisma: prismaMock }));
vi.mock('@/features/support/api/support-api.server', () => ({
  requireSupportApi: requireSupport,
  recordSupportAccess: recordAccess,
}));
vi.mock('@/features/school-invitations/use-cases', () => ({
  findReusableSchoolInvitation: findReusable,
  createCommercialSchoolInvitation: createUseCase,
}));

import { POST } from '@/app/api/admin/school-invitations/route';

describe('POST /api/admin/school-invitations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSupport.mockResolvedValue({ ok: true, session: { supportUserId: 'support-1' } });
    findReusable.mockResolvedValue(null);
    createUseCase.mockResolvedValue({ kind: 'created', data: { id: 'invitation-1', emailDeliveryStatus: 'SENT' } });
  });

  it('requires support authorization before invoking invitation operations', async () => {
    requireSupport.mockResolvedValue({ ok: false, response: new Response('forbidden', { status: 403 }) });
    const response = await POST(new Request('https://admin.test', { method: 'POST', headers: { 'idempotency-key': 'request-1' }, body: '{}' }));

    expect(response.status).toBe(403);
    expect(findReusable).not.toHaveBeenCalled();
    expect(createUseCase).not.toHaveBeenCalled();
  });

  it('reuses an idempotent invitation before parsing a replay body', async () => {
    findReusable.mockResolvedValue({ id: 'invitation-1', reused: true, requiresResend: true });
    const response = await POST(new Request('https://admin.test', {
      method: 'POST', headers: { 'idempotency-key': 'request-1' }, body: 'not-json',
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, data: { id: 'invitation-1', reused: true } });
    expect(createUseCase).not.toHaveBeenCalled();
  });

  it('validates the DTO in the handler and translates successful use-case output', async () => {
    const response = await POST(new Request('https://admin.test/invitations', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'request-1' },
      body: JSON.stringify({
        schoolName: 'Escola Nova', contactName: 'Pessoa', email: 'ADMIN@ESCOLA.TEST', conditionType: 'STANDARD',
        studentCount: 250, planCode: 'BAND_001_025',
      }),
    }));

    expect(response.status).toBe(201);
    expect(createUseCase).toHaveBeenCalledWith(expect.objectContaining({
      requestIdempotencyKey: 'request-1', createdByAdminId: 'support-1',
      data: expect.objectContaining({ email: 'admin@escola.test', trialDays: 14, studentCount: 250, planCode: 'BAND_201_300' }),
    }));
    expect(recordAccess).toHaveBeenCalledWith(expect.any(Request), expect.objectContaining({ action: 'admin.school_invitation.created' }));
  });

  it('rejects standard counts above 500 before invoking the use case', async () => {
    const response = await POST(new Request('https://admin.test/invitations', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'request-1' },
      body: JSON.stringify({ schoolName: 'Escola Nova', contactName: 'Pessoa', email: 'admin@escola.test', conditionType: 'STANDARD', studentCount: 501, planCode: 'BAND_401_500' }),
    }));
    expect(response.status).toBe(400);
    expect(createUseCase).not.toHaveBeenCalled();
  });
});
