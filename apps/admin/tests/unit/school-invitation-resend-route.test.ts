import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, requireSupport, recordAccess, resendUseCase } = vi.hoisted(() => ({
  prismaMock: {},
  requireSupport: vi.fn(),
  recordAccess: vi.fn(),
  resendUseCase: vi.fn(),
}));

vi.mock('@alusa/database', () => ({ prisma: prismaMock }));
vi.mock('@/features/support/api/support-api.server', () => ({
  requireSupportApi: requireSupport,
  recordSupportAccess: recordAccess,
}));
vi.mock('@/features/school-invitations/use-cases', () => ({
  resendCommercialSchoolInvitation: resendUseCase,
  SchoolInvitationUseCaseError: class SchoolInvitationUseCaseError extends Error { constructor(readonly code: string, message: string) { super(message); } },
}));

import { POST } from '@/app/api/admin/school-invitations/[id]/resend/route';

describe('POST /api/admin/school-invitations/:id/resend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSupport.mockResolvedValue({ ok: true, session: { supportUserId: 'support-1' } });
    resendUseCase.mockResolvedValue({ kind: 'resent', data: { url: 'https://alusa.test/convite-escola/token', expiresAt: new Date(), emailDeliveryStatus: 'UNKNOWN', emailDeliveryErrorCode: 'EMAIL_DELIVERY_AMBIGUOUS' } });
  });

  it('returns the rotated link when delivery is ambiguous and records the resend', async () => {
    const response = await POST(new Request('https://admin.test/api', { method: 'POST', headers: { 'idempotency-key': 'resend-1' } }), { params: Promise.resolve({ id: 'invitation-1' }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, data: { emailDeliveryStatus: 'UNKNOWN', url: expect.stringContaining('/convite-escola/token') } });
    expect(resendUseCase).toHaveBeenCalledWith(expect.objectContaining({ id: 'invitation-1', actorId: 'support-1', requestKey: 'resend-1' }));
    expect(recordAccess).toHaveBeenCalledWith(expect.any(Request), expect.objectContaining({ action: 'admin.school_invitation.resent' }));
  });

  it('maps an idempotent duplicate to success without another support audit', async () => {
    resendUseCase.mockResolvedValue({ kind: 'reused', data: { reused: true, url: 'https://alusa.test/convite-escola/token', emailDeliveryStatus: 'UNKNOWN' } });
    const response = await POST(new Request('https://admin.test/api', { method: 'POST', headers: { 'idempotency-key': 'resend-1' } }), { params: Promise.resolve({ id: 'invitation-1' }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, data: { reused: true, url: expect.stringContaining('/convite-escola/token'), emailDeliveryStatus: 'UNKNOWN' } });
    expect(recordAccess).not.toHaveBeenCalled();
  });

  it('maps a concurrent claim to stable replay and a cooldown to 429', async () => {
    resendUseCase.mockResolvedValueOnce({ kind: 'reused', data: { reused: true, emailDeliveryStatus: 'PENDING' } });
    const replay = await POST(new Request('https://admin.test/api', { method: 'POST', headers: { 'idempotency-key': 'resend-1' } }), { params: Promise.resolve({ id: 'invitation-1' }) });
    expect(replay.status).toBe(200);

    resendUseCase.mockResolvedValueOnce({ kind: 'rate_limited' });
    const limited = await POST(new Request('https://admin.test/api', { method: 'POST', headers: { 'idempotency-key': 'resend-2' } }), { params: Promise.resolve({ id: 'invitation-1' }) });
    expect(limited.status).toBe(429);
  });

  it('returns the active link when an older delivery finishes after a newer resend', async () => {
    resendUseCase.mockResolvedValue({ kind: 'stale', data: { reused: true, stale: true, url: 'https://alusa.test/convite-escola/current', emailDeliveryStatus: 'SENT' } });
    const response = await POST(new Request('https://admin.test/api', { method: 'POST', headers: { 'idempotency-key': 'resend-a' } }), { params: Promise.resolve({ id: 'invitation-1' }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, data: { reused: true, stale: true, url: expect.stringContaining('/current') } });
    expect(recordAccess).toHaveBeenCalledWith(expect.any(Request), expect.objectContaining({ metadata: expect.objectContaining({ stale: true }) }));
  });

  it('fails closed with service unavailable when the stable resend secret is missing', async () => {
    const { SchoolInvitationUseCaseError } = await import('@/features/school-invitations/use-cases');
    resendUseCase.mockRejectedValue(new SchoolInvitationUseCaseError('RESEND_TOKEN_SECRET_UNAVAILABLE', 'Chave ausente.'));
    const response = await POST(new Request('https://admin.test/api', { method: 'POST', headers: { 'idempotency-key': 'resend-1' } }), { params: Promise.resolve({ id: 'invitation-1' }) });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ success: false, code: 'RESEND_TOKEN_SECRET_UNAVAILABLE' });
  });
});
