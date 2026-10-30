import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createCommercialSchoolInvitation, resendCommercialSchoolInvitation } from '@/features/school-invitations/use-cases';

function makeDb() {
  const resendRequestLedger = new Set<string>();
  const invitation: Record<string, any> = {
    id: 'invitation-1', status: 'PENDING', emailResendRequestKey: null, emailResentAt: null,
    emailDeliveryStatus: 'SENT', emailDeliveryErrorCode: null, emailSentAt: new Date('2026-01-01T00:00:00Z'),
    tokenHash: 'old-hash', requestIdempotencyKey: 'existing-create-key', expiresAt: new Date('2030-01-01T00:00:00Z'), email: 'admin@example.test', schoolName: 'Escola Nova',
  };
  const history = vi.fn(async (_input: { data: { action: string; after?: Record<string, unknown> } }) => ({}));
  const updateMany = vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    if (invitation.id !== where.id || ('status' in where && invitation.status !== where.status)) return { count: 0 };
    if ('emailResentAt' in where && invitation.emailResentAt !== where.emailResentAt) return { count: 0 };
    if ('tokenHash' in where && invitation.tokenHash !== where.tokenHash) return { count: 0 };
    if ('emailResendRequestKey' in where && invitation.emailResendRequestKey !== where.emailResendRequestKey) return { count: 0 };
    if ('requestIdempotencyKey' in where && invitation.requestIdempotencyKey !== where.requestIdempotencyKey) return { count: 0 };
    Object.assign(invitation, data);
    return { count: 1 };
  });
  const tx = {
    platformSchoolInvitation: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(invitation, data)),
      updateMany,
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(invitation, data)),
    },
    platformSchoolInvitationConditionVersion: { create: vi.fn(async () => ({})) },
    platformSchoolInvitationResendRequest: { createMany: vi.fn(async ({ data }: { data: Array<{ invitationId: string; requestKeyFingerprint: string }> }) => {
      let count = 0;
      for (const row of data) {
        const key = `${row.invitationId}:${row.requestKeyFingerprint}`;
        if (!resendRequestLedger.has(key)) { resendRequestLedger.add(key); count += 1; }
      }
      return { count };
    }) },
    platformSchoolInvitationHistory: { create: history },
  };
  const db = {
    platformSchoolInvitation: {
      findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if ('id' in where && invitation.id !== where.id) return null;
        if ('requestIdempotencyKey' in where && invitation.requestIdempotencyKey !== where.requestIdempotencyKey) return null;
        return { ...invitation };
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(invitation, data)),
    },
    platformSchoolInvitationResendRequest: {
      findUnique: vi.fn(async ({ where }: { where: { invitationId_requestKeyFingerprint: { invitationId: string; requestKeyFingerprint: string } } }) => {
        const key = `${where.invitationId_requestKeyFingerprint.invitationId}:${where.invitationId_requestKeyFingerprint.requestKeyFingerprint}`;
        return resendRequestLedger.has(key) ? { invitationId: where.invitationId_requestKeyFingerprint.invitationId } : null;
      }),
    },
    platformSchoolInvitationConditionVersion: { create: vi.fn(async () => ({})) },
    platformSchoolInvitationHistory: { create: history },
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return { db, invitation, updateMany, history, tx, resendRequestLedger };
}

const fixedNow = new Date('2026-10-28T12:00:00.000Z');
const signingSecret = 'stable-school-invitation-resend-secret-32-bytes-min';

afterEach(() => { vi.unstubAllEnvs(); });

describe('resendCommercialSchoolInvitation', () => {
  it('keeps the rotated link usable and persists UNKNOWN when email delivery is ambiguous', async () => {
    vi.stubEnv('SCHOOL_INVITATION_RESEND_SECRET', signingSecret);
    const h = makeDb();
    const sendEmail = vi.fn(async () => { throw Object.assign(new Error('timeout'), { code: 'EMAIL_DELIVERY_AMBIGUOUS' }); });
    const result = await resendCommercialSchoolInvitation({
      db: h.db as never, id: 'invitation-1', actorId: 'support-1', requestKey: 'resend-1',
      baseUrl: 'https://alusa.test', now: fixedNow, sendEmail,
    });

    expect(result).toMatchObject({ kind: 'resent', data: { url: expect.stringMatching(/^https:\/\/alusa\.test\/convite-escola\/[A-Za-z0-9_-]{43}$/), emailDeliveryStatus: 'UNKNOWN' } });
    expect(h.invitation).toMatchObject({ emailResendRequestKey: 'resend-1', emailDeliveryStatus: 'UNKNOWN', tokenHash: expect.any(String) });
    expect(h.invitation.expiresAt).toEqual(new Date(fixedNow.getTime() + 72 * 60 * 60 * 1000));
    expect(h.history).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'EMAIL_DELIVERY_UNKNOWN' }) }));
  });

  it('reuses the same request key without rotating or sending again', async () => {
    vi.stubEnv('SCHOOL_INVITATION_RESEND_SECRET', signingSecret);
    const h = makeDb();
    const sendEmail = vi.fn(async () => ({ status: 'SENT' as const, sentAt: fixedNow }));
    const input = { db: h.db as never, id: 'invitation-1', actorId: 'support-1', requestKey: 'resend-1', baseUrl: 'https://alusa.test', now: fixedNow, sendEmail };
    const first = await resendCommercialSchoolInvitation(input);
    const second = await resendCommercialSchoolInvitation(input);

    expect(first).toMatchObject({ kind: 'resent', data: { emailDeliveryStatus: 'SENT' } });
    expect(second).toEqual({ kind: 'reused', data: { reused: true, url: first.kind === 'resent' ? first.data.url : '', expiresAt: new Date(fixedNow.getTime() + 72 * 60 * 60 * 1000), emailDeliveryStatus: 'SENT' } });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(h.updateMany).toHaveBeenCalledTimes(2); // claim + one guarded outcome update
  });

  it('allows only one concurrent token claim and returns reuse to the losing request', async () => {
    vi.stubEnv('SCHOOL_INVITATION_RESEND_SECRET', signingSecret);
    const h = makeDb();
    let readers = 0;
    let releaseReaders!: () => void;
    const barrier = new Promise<void>((resolve) => { releaseReaders = resolve; });
    h.db.platformSchoolInvitation.findUnique.mockImplementation(async () => {
      const snapshot = { ...h.invitation };
      readers += 1;
      if (readers === 2) releaseReaders();
      await barrier;
      return snapshot;
    });
    const sendEmail = vi.fn(async () => ({ status: 'SENT' as const, sentAt: fixedNow }));
    const common = { db: h.db as never, id: 'invitation-1', actorId: 'support-1', baseUrl: 'https://alusa.test', now: fixedNow, sendEmail };
    const [first, second] = await Promise.all([
      resendCommercialSchoolInvitation({ ...common, requestKey: 'resend-a' }),
      resendCommercialSchoolInvitation({ ...common, requestKey: 'resend-b' }),
    ]);

    expect([first.kind, second.kind].sort()).toEqual(['resent', 'reused']);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(h.updateMany).toHaveBeenCalledTimes(3); // two claims, one winning guarded outcome
    expect(h.history).toHaveBeenCalledTimes(2); // one LINK_REISSUED plus one EMAIL_SENT
    const firstUrl = 'data' in first && first.data && 'url' in first.data ? first.data.url : null;
    const secondUrl = 'data' in second && second.data && 'url' in second.data ? second.data.url : null;
    expect(firstUrl).toBe(secondUrl);
  });

  it('does not let slow resend A overwrite or audit SENT after newer resend B completes', async () => {
    vi.stubEnv('SCHOOL_INVITATION_RESEND_SECRET', signingSecret);
    const h = makeDb();
    let markASending!: () => void;
    let finishA!: () => void;
    const aStarted = new Promise<void>((resolve) => { markASending = resolve; });
    const aGate = new Promise<void>((resolve) => { finishA = resolve; });
    let sends = 0;
    const sendEmail = vi.fn(async () => {
      sends += 1;
      if (sends === 1) { markASending(); await aGate; }
      return { status: 'SENT' as const, sentAt: fixedNow };
    });
    const base = { db: h.db as never, id: 'invitation-1', actorId: 'support-1', baseUrl: 'https://alusa.test', sendEmail };
    const aPromise = resendCommercialSchoolInvitation({ ...base, requestKey: 'resend-a', now: fixedNow });
    await aStarted;
    const resultB = await resendCommercialSchoolInvitation({ ...base, requestKey: 'resend-b', now: new Date(fixedNow.getTime() + 61_000) });
    expect(resultB.kind).toBe('resent');
    if (resultB.kind !== 'resent') throw new Error('Expected resend B to own the active token');
    if (!resultB.data.url) throw new Error('Expected resend B to return its active link');
    finishA();
    const resultA = await aPromise;

    expect(resultA).toMatchObject({ kind: 'stale', data: { reused: true, emailDeliveryStatus: 'SENT', url: resultB.data.url } });
    expect(h.invitation).toMatchObject({ emailResendRequestKey: 'resend-b', emailDeliveryStatus: 'SENT' });
    expect(h.invitation.tokenHash).toBe(createHash('sha256').update(resultB.data.url.split('/').at(-1)!).digest('hex'));
    const emailSentEntries = h.history.mock.calls
      .map(([entry]) => entry as { data: { action: string; after?: Record<string, unknown> } })
      .filter((entry) => entry.data.action === 'EMAIL_SENT');
    expect(emailSentEntries).toHaveLength(1);
    expect(emailSentEntries[0]?.data.after?.requestKeyFingerprint).toBe(createHash('sha256').update('resend-b').digest('hex').slice(0, 24));
    expect(emailSentEntries[0]?.data.after?.requestKeyFingerprint).not.toBe(createHash('sha256').update('resend-a').digest('hex').slice(0, 24));
    expect(h.history).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'EMAIL_DELIVERY_STALE' }) }));
    expect(sendEmail).toHaveBeenCalledTimes(2);

    const claimsAfterAAndB = h.updateMany.mock.calls.length;
    const lateReplayA = await resendCommercialSchoolInvitation({
      ...base, requestKey: 'resend-a', now: new Date(fixedNow.getTime() + 122_000),
    });
    expect(lateReplayA).toMatchObject({ kind: 'reused', data: { reused: true, stale: true, url: resultB.data.url, emailDeliveryStatus: 'SENT' } });
    expect(h.invitation).toMatchObject({ emailResendRequestKey: 'resend-b', emailDeliveryStatus: 'SENT' });
    expect(h.updateMany).toHaveBeenCalledTimes(claimsAfterAAndB);
    expect(h.resendRequestLedger.size).toBe(2);
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it('guards the original create email outcome against a newer resend token', async () => {
    vi.stubEnv('SCHOOL_INVITATION_RESEND_SECRET', signingSecret);
    const h = makeDb();
    let markCreateSending!: () => void;
    let finishCreate!: () => void;
    const createStarted = new Promise<void>((resolve) => { markCreateSending = resolve; });
    const createGate = new Promise<void>((resolve) => { finishCreate = resolve; });
    let sends = 0;
    const sendEmail = vi.fn(async () => {
      sends += 1;
      if (sends === 1) { markCreateSending(); await createGate; }
      return { status: 'SENT' as const, sentAt: fixedNow };
    });
    const createPromise = createCommercialSchoolInvitation({
      db: h.db as never,
      data: { schoolName: 'Escola Nova', contactName: 'Pessoa', email: 'admin@example.test', conditionType: 'STANDARD', studentCount: 20, planCode: 'BAND_001_025', trialDays: 14 },
      requestIdempotencyKey: 'create-1', token: 'original-token', expiresAt: new Date(fixedNow.getTime() + 72 * 60 * 60 * 1000),
      createdByAdminId: 'support-1', baseUrl: 'https://alusa.test', sendEmail,
    });
    await createStarted;
    const invitationId = h.invitation.id as string;
    const resultB = await resendCommercialSchoolInvitation({
      db: h.db as never, id: invitationId, actorId: 'support-1', requestKey: 'resend-b',
      baseUrl: 'https://alusa.test', now: new Date(fixedNow.getTime() + 61_000), sendEmail,
    });
    if (resultB.kind !== 'resent' || !resultB.data.url) throw new Error('Expected resend B to complete');
    finishCreate();
    const resultCreate = await createPromise;

    expect(resultCreate).toMatchObject({ kind: 'created', data: { stale: true, emailDeliveryStatus: 'SENT', url: resultB.data.url } });
    expect(h.invitation).toMatchObject({ emailResendRequestKey: 'resend-b', emailDeliveryStatus: 'SENT' });
    expect(h.invitation.tokenHash).toBe(createHash('sha256').update(resultB.data.url.split('/').at(-1)!).digest('hex'));
    const sentEntries = h.history.mock.calls
      .map(([entry]) => entry as { data: { action: string; after?: Record<string, unknown> } })
      .filter((entry) => entry.data.action === 'EMAIL_SENT');
    expect(sentEntries).toHaveLength(1);
    expect(sentEntries[0]?.data.after?.requestKeyFingerprint).toBe(createHash('sha256').update('resend-b').digest('hex').slice(0, 24));
    expect(h.history).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'EMAIL_DELIVERY_STALE' }) }));
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it('returns UNKNOWN when provider succeeds but persistence fails, then safely persists uncertainty without sending again', async () => {
    vi.stubEnv('SCHOOL_INVITATION_RESEND_SECRET', signingSecret);
    const h = makeDb();
    h.db.$transaction
      .mockImplementationOnce(async (callback) => callback(h.tx)) // claim
      .mockRejectedValueOnce(new Error('database timeout after provider success')) // SENT persistence
      .mockImplementationOnce(async (callback) => callback(h.tx)); // UNKNOWN recovery
    const sendEmail = vi.fn(async () => ({ status: 'SENT' as const, sentAt: fixedNow }));

    const result = await resendCommercialSchoolInvitation({
      db: h.db as never, id: 'invitation-1', actorId: 'support-1', requestKey: 'resend-1',
      baseUrl: 'https://alusa.test', now: fixedNow, sendEmail,
    });

    expect(result).toMatchObject({ kind: 'resent', data: { emailDeliveryStatus: 'UNKNOWN', emailDeliveryErrorCode: 'EMAIL_DELIVERY_STATE_PERSIST_FAILED' } });
    expect(h.invitation).toMatchObject({ emailDeliveryStatus: 'UNKNOWN', emailDeliveryErrorCode: 'EMAIL_DELIVERY_STATE_PERSIST_FAILED' });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(h.history).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'EMAIL_DELIVERY_UNKNOWN' }) }));
    const replay = await resendCommercialSchoolInvitation({
      db: h.db as never, id: 'invitation-1', actorId: 'support-1', requestKey: 'resend-1',
      baseUrl: 'https://alusa.test', now: new Date(fixedNow.getTime() + 1_000), sendEmail,
    });
    expect(replay).toMatchObject({ kind: 'reused', data: { emailDeliveryStatus: 'UNKNOWN' } });
    expect(replay.kind === 'reused' && result.kind === 'resent' ? replay.data.url : null).toBe(result.kind === 'resent' ? result.data.url : null);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('fails closed without a sufficiently long signing secret', async () => {
    vi.stubEnv('SCHOOL_INVITATION_RESEND_SECRET', 'short');
    const h = makeDb();
    const sendEmail = vi.fn();

    await expect(resendCommercialSchoolInvitation({
      db: h.db as never, id: 'invitation-1', actorId: 'support-1', requestKey: 'resend-1',
      baseUrl: 'https://alusa.test', now: fixedNow, sendEmail,
    })).rejects.toMatchObject({ code: 'RESEND_TOKEN_SECRET_UNAVAILABLE' });
    expect(h.updateMany).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
