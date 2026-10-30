import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import prisma from '@/lib/prisma';
import { createFirstUser, EmailInUseError, SchoolInvitationInvalidError } from '@/lib/first-user-service';
import { acceptInvitationCondition } from '@/src/server/platform-billing/accept-invitation-condition';
import { resolveSchoolCommercialTarget } from '@alusa/platform-billing';

const isTestDatabase = (() => {
  try {
    const url = new URL(process.env.DATABASE_URL ?? '');
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const name = decodeURIComponent(url.pathname.replace(/^\/+/, '')).toLowerCase();
    return ['postgres:', 'postgresql:'].includes(url.protocol.toLowerCase())
      && ['localhost', '127.0.0.1', '::1'].includes(host)
      && (name === 'alusa_test' || name.startsWith('alusa_test_'));
  } catch {
    return false;
  }
})();

afterAll(async () => {
  await prisma.$disconnect();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function createDatabaseWithClaimGate(gate: (run: () => Promise<Prisma.BatchPayload>) => Promise<Prisma.BatchPayload>): typeof prisma {
  const originalTransaction = prisma.$transaction.bind(prisma);
  return new Proxy(prisma, {
    get(target, property, receiver) {
      if (property !== '$transaction') return Reflect.get(target, property, receiver);
      return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => originalTransaction((tx) => callback(new Proxy(tx, {
        get(transaction, transactionProperty, transactionReceiver) {
          if (transactionProperty !== 'platformSchoolInvitation') return Reflect.get(transaction, transactionProperty, transactionReceiver);
          const invitationDelegate = Reflect.get(transaction, transactionProperty, transaction) as typeof tx.platformSchoolInvitation;
          return new Proxy(invitationDelegate, {
            get(delegate, method, delegateReceiver) {
              if (method !== 'updateMany') return Reflect.get(delegate, method, delegateReceiver);
              return (args: Parameters<typeof tx.platformSchoolInvitation.updateMany>[0]) => gate(() => delegate.updateMany(args));
            },
          });
        },
      }) as Prisma.TransactionClient));
    },
  }) as typeof prisma;
}

function createDatabaseWithLateAcceptanceHistoryFailure(): typeof prisma {
  const originalTransaction = prisma.$transaction.bind(prisma);
  let failurePending = true;
  return new Proxy(prisma, {
    get(target, property, receiver) {
      if (property !== '$transaction') return Reflect.get(target, property, receiver);
      return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => originalTransaction((tx) => callback(new Proxy(tx, {
        get(transaction, transactionProperty, transactionReceiver) {
          if (transactionProperty !== 'platformSchoolInvitationHistory') return Reflect.get(transaction, transactionProperty, transactionReceiver);
          const historyDelegate = Reflect.get(transaction, transactionProperty, transaction) as typeof tx.platformSchoolInvitationHistory;
          return new Proxy(historyDelegate, {
            get(delegate, method, delegateReceiver) {
              if (method !== 'create') return Reflect.get(delegate, method, delegateReceiver);
              return (args: Parameters<typeof tx.platformSchoolInvitationHistory.create>[0]) => {
                if (failurePending && args.data.action === 'ACCEPTED') {
                  failurePending = false;
                  throw new Error('Injected late invitation history write failure');
                }
                return delegate.create(args);
              };
            },
          });
        },
      }) as Prisma.TransactionClient));
    },
  }) as typeof prisma;
}

describe.skipIf(!isTestDatabase)('commercial school invitation acceptance transaction races', () => {
  async function createFixture(scenario: string) {
    const suffix = randomUUID().replaceAll('-', '');
    const token = `commercial-invitation-token-${suffix}`;
    const schoolName = `Invitation race ${scenario} ${suffix}`;
    const email = `invitation-race-${suffix}@example.test`;
    const invitation = await prisma.platformSchoolInvitation.create({ data: {
      tokenHash: createHash('sha256').update(token).digest('hex'),
      requestIdempotencyKey: `invitation-race-request-${suffix}`,
      schoolName,
      contactName: 'Integration Admin',
      email,
      planCode: 'BAND_001_025',
      studentCount: 20,
      expiresAt: new Date(Date.now() + 60 * 60_000),
      createdByAdminId: 'integration_admin',
    } });
    return { token, schoolName, email, invitation };
  }

  async function cleanup(fixture: Awaited<ReturnType<typeof createFixture>>) {
    const conta = await prisma.conta.findFirst({ where: { nome: fixture.schoolName }, select: { id: true } });
    await prisma.platformSchoolInvitationHistory.deleteMany({ where: { invitationId: fixture.invitation.id } });
    await prisma.platformSchoolInvitation.deleteMany({ where: { id: fixture.invitation.id } });
    if (conta) await prisma.conta.delete({ where: { id: conta.id } });
    await prisma.usuario.deleteMany({ where: { email: fixture.email } });
  }

  const registration = (fixture: Awaited<ReturnType<typeof createFixture>>, database: typeof prisma = prisma) => createFirstUser({
    escolaNome: fixture.schoolName,
    nome: 'Integration Admin',
    email: fixture.email,
    senha: 'AlusaRace#2026Strong',
    schoolInvitationToken: fixture.token,
  }, database);

  it('rolls back Conta, Usuario and acceptance history when revoke wins after onboarding writes began', async () => {
    const fixture = await createFixture('revoke-wins');
    const claimReached = deferred();
    const allowClaim = deferred();
    const gatedDatabase = createDatabaseWithClaimGate(async (run) => {
      claimReached.resolve();
      await allowClaim.promise;
      return run();
    });

    try {
      const acceptance = registration(fixture, gatedDatabase).then(() => null, (error: unknown) => error);
      await claimReached.promise;

      await prisma.$transaction(async (tx) => {
        const revoked = await tx.platformSchoolInvitation.updateMany({
          where: { id: fixture.invitation.id, status: 'PENDING' },
          data: { status: 'REVOKED', revokedAt: new Date() },
        });
        expect(revoked.count).toBe(1);
        await tx.platformSchoolInvitationHistory.create({ data: {
          invitationId: fixture.invitation.id,
          actorId: 'integration_admin',
          action: 'REVOKED',
          before: { status: 'PENDING' },
          after: { status: 'REVOKED' },
        } });
      });
      allowClaim.resolve();

      expect(await acceptance).toBeInstanceOf(SchoolInvitationInvalidError);
      const invitation = await prisma.platformSchoolInvitation.findUniqueOrThrow({ where: { id: fixture.invitation.id } });
      expect(invitation).toMatchObject({ status: 'REVOKED', acceptedAt: null, acceptedContaId: null });
      expect(await prisma.conta.count({ where: { nome: fixture.schoolName } })).toBe(0);
      expect(await prisma.usuario.count({ where: { email: fixture.email } })).toBe(0);
      expect(await prisma.usuarioConta.count({ where: { usuario: { is: { email: fixture.email } } } })).toBe(0);
      expect(await prisma.platformSchoolInvitationHistory.count({ where: { invitationId: fixture.invitation.id, action: 'ACCEPTED' } })).toBe(0);
      expect(await prisma.platformSchoolInvitationHistory.count({ where: { invitationId: fixture.invitation.id, action: 'REVOKED' } })).toBe(1);
    } finally {
      allowClaim.resolve();
      await cleanup(fixture);
    }
  }, 30_000);

  it('keeps the accepted tenant and history when revoke loses after the service claimed the invitation', async () => {
    const fixture = await createFixture('acceptance-wins');
    const claimUpdated = deferred();
    const allowAcceptanceCommit = deferred();
    const gatedDatabase = createDatabaseWithClaimGate(async (run) => {
      const result = await run();
      claimUpdated.resolve();
      await allowAcceptanceCommit.promise;
      return result;
    });

    try {
      const acceptance = createFirstUser({
        escolaNome: fixture.schoolName,
        nome: 'Integration Admin',
        email: fixture.email,
        senha: 'AlusaRace#2026Strong',
        schoolInvitationToken: fixture.token,
      }, gatedDatabase);
      await claimUpdated.promise;

      const revokeStarted = deferred();
      const revoke = prisma.$transaction(async (tx) => {
        const pendingUpdate = tx.platformSchoolInvitation.updateMany({
          where: { id: fixture.invitation.id, status: 'PENDING' },
          data: { status: 'REVOKED', revokedAt: new Date() },
        });
        revokeStarted.resolve();
        return pendingUpdate;
      });
      await revokeStarted.promise;
      allowAcceptanceCommit.resolve();

      const user = await acceptance;
      const revokeResult = await revoke;
      expect(revokeResult.count).toBe(0);
      const invitation = await prisma.platformSchoolInvitation.findUniqueOrThrow({ where: { id: fixture.invitation.id } });
      expect(invitation).toMatchObject({ status: 'ACCEPTED', acceptedContaId: user.contaId, acceptedAt: expect.any(Date) });
      expect(await prisma.conta.count({ where: { id: user.contaId } })).toBe(1);
      expect(await prisma.usuario.count({ where: { id: user.id, contaId: user.contaId } })).toBe(1);
      expect(await prisma.usuarioConta.count({ where: { usuarioId: user.id, contaId: user.contaId } })).toBe(1);
      expect(await prisma.platformSchoolInvitationHistory.count({ where: { invitationId: fixture.invitation.id, action: 'ACCEPTED' } })).toBe(1);
      expect(await prisma.platformSchoolInvitationHistory.count({ where: { invitationId: fixture.invitation.id, action: 'REVOKED' } })).toBe(0);
      await expect(prisma.conta.delete({ where: { id: user.contaId } })).rejects.toMatchObject({ code: 'P2003' });
    } finally {
      allowAcceptanceCommit.resolve();
      await cleanup(fixture);
    }
  }, 30_000);

  it('creates exactly one tenant owner when two acceptances race on the same invitation token', async () => {
    const fixture = await createFixture('double-acceptance');
    const bothTransactionsStarted = deferred();
    const allowTransactions = deferred();
    let transactionArrivals = 0;
    const originalTransaction = prisma.$transaction.bind(prisma);
    const gatedDatabase = new Proxy(prisma, {
      get(target, property, receiver) {
        if (property !== '$transaction') return Reflect.get(target, property, receiver);
        return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
          transactionArrivals += 1;
          if (transactionArrivals === 2) bothTransactionsStarted.resolve();
          return (async () => {
            await allowTransactions.promise;
            return originalTransaction((tx) => callback(tx));
          })();
        };
      },
    }) as typeof prisma;

    try {
      const first = registration(fixture, gatedDatabase);
      const second = registration(fixture, gatedDatabase);
      await bothTransactionsStarted.promise;
      allowTransactions.resolve();
      const outcomes = await Promise.allSettled([first, second]);
      const winners = outcomes.filter((outcome): outcome is PromiseFulfilledResult<Awaited<ReturnType<typeof registration>>> => outcome.status === 'fulfilled');
      const losers = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect(losers[0]?.reason).toBeInstanceOf(EmailInUseError);
      const replayed = await registration(fixture);
      expect(replayed.id).toBe(winners[0]!.value.id);
      expect(replayed.contaId).toBe(winners[0]!.value.contaId);

      const accepted = await prisma.platformSchoolInvitation.findUniqueOrThrow({ where: { id: fixture.invitation.id } });
      expect(accepted).toMatchObject({ status: 'ACCEPTED', acceptedContaId: winners[0]!.value.contaId, acceptedAt: expect.any(Date) });
      expect(await prisma.conta.count({ where: { nome: fixture.schoolName } })).toBe(1);
      expect(await prisma.usuario.count({ where: { email: fixture.email } })).toBe(1);
      expect(await prisma.usuarioConta.count({ where: { usuario: { is: { email: fixture.email } }, contaId: accepted.acceptedContaId! } })).toBe(1);
      expect(await prisma.platformSchoolInvitationHistory.count({ where: { invitationId: fixture.invitation.id, action: 'ACCEPTED' } })).toBe(1);
    } finally {
      allowTransactions.resolve();
      await cleanup(fixture);
    }
  }, 30_000);

  it('rolls back an invitation claim after a late history failure and retries acceptance exactly once', async () => {
    const fixture = await createFixture('late-history-failure');
    const failingDatabase = createDatabaseWithLateAcceptanceHistoryFailure();

    try {
      await expect(registration(fixture, failingDatabase)).rejects.toThrow('Injected late invitation history write failure');

      const rolledBackInvitation = await prisma.platformSchoolInvitation.findUniqueOrThrow({ where: { id: fixture.invitation.id } });
      expect(rolledBackInvitation).toMatchObject({ status: 'PENDING', acceptedAt: null, acceptedContaId: null });
      expect(await prisma.conta.count({ where: { nome: fixture.schoolName } })).toBe(0);
      expect(await prisma.usuario.count({ where: { email: fixture.email } })).toBe(0);
      expect(await prisma.platformSchoolInvitationHistory.count({ where: { invitationId: fixture.invitation.id, action: 'ACCEPTED' } })).toBe(0);

      const acceptedUser = await registration(fixture);
      const retry = await registration(fixture);
      const acceptedInvitation = await prisma.platformSchoolInvitation.findUniqueOrThrow({ where: { id: fixture.invitation.id } });
      expect(acceptedInvitation).toMatchObject({ status: 'ACCEPTED', acceptedContaId: acceptedUser.contaId, acceptedAt: expect.any(Date) });
      expect(retry).toMatchObject({ id: acceptedUser.id, contaId: acceptedUser.contaId });
      expect(await prisma.conta.count({ where: { nome: fixture.schoolName } })).toBe(1);
      expect(await prisma.usuario.count({ where: { email: fixture.email } })).toBe(1);
      expect(await prisma.platformSchoolInvitationHistory.count({ where: { invitationId: fixture.invitation.id, action: 'ACCEPTED' } })).toBe(1);
    } finally {
      await cleanup(fixture);
    }
  }, 30_000);

  it('rejects attaching an invitation acceptance to a tenant other than the accepted Conta', async () => {
    const suffix = randomUUID().replaceAll('-', '');
    const acceptedContaId = `invite_accepted_${suffix}`;
    const otherContaId = `invite_other_${suffix}`;
    const invitationId = `invite_fk_${suffix}`;
    const tokenHash = createHash('sha256').update(suffix).digest('hex');

    try {
      await prisma.conta.createMany({ data: [
        { id: acceptedContaId, nome: `Accepted invitation tenant ${suffix}` },
        { id: otherContaId, nome: `Other invitation tenant ${suffix}` },
      ] });
      await prisma.platformSchoolInvitation.create({ data: {
        id: invitationId,
        tokenHash,
        requestIdempotencyKey: `invitation-fk-${suffix}`,
        schoolName: `Accepted invitation tenant ${suffix}`,
        contactName: 'Integration Admin',
        email: `invitation-fk-${suffix}@example.test`,
        planCode: 'BAND_001_025',
        studentCount: 20,
        expiresAt: new Date(Date.now() + 60 * 60_000),
        status: 'ACCEPTED',
        acceptedAt: new Date(),
        acceptedContaId,
        createdByAdminId: 'integration_admin',
      } });
      await prisma.platformSchoolInvitationConditionVersion.create({ data: {
        invitationId, version: 1, snapshot: { planCode: 'BAND_001_025', studentCount: 20 }, createdBy: 'integration_admin',
      } });

      await expect(prisma.platformSchoolInvitationConditionAcceptance.create({
        data: {
          invitationId, version: 1, contaId: otherContaId, acceptedBy: 'other_admin',
          selectedStudentCount: 20, selectedPlanCode: 'BAND_001_025', selectedMonthlyAmountCents: 9_900,
        },
      })).rejects.toMatchObject({ code: 'P2003' });
    } finally {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
        await tx.platformSchoolInvitationConditionAcceptance.deleteMany({ where: { invitationId } });
        await tx.platformSchoolInvitationHistory.deleteMany({ where: { invitationId } });
        await tx.platformSchoolInvitationConditionVersion.deleteMany({ where: { invitationId } });
        await tx.platformSchoolInvitation.deleteMany({ where: { id: invitationId } });
        await tx.conta.deleteMany({ where: { id: { in: [acceptedContaId, otherContaId] } } });
      });
    }
  }, 30_000);

  it('converges two simultaneous identical commercial condition acceptances to one row and one history entry', async () => {
    const suffix = randomUUID().replaceAll('-', '');
    const contaId = `condition_accept_${suffix}`;
    const schoolName = `Condition acceptance race ${suffix}`;
    const invitationId = `condition_invitation_${suffix}`;
    const acceptedAt = new Date();
    const version = 1;
    try {
      await prisma.conta.create({ data: { id: contaId, nome: schoolName } });
      await prisma.platformSchoolInvitation.create({ data: {
        id: invitationId,
        tokenHash: createHash('sha256').update(suffix).digest('hex'),
        requestIdempotencyKey: `condition-invitation-request-${suffix}`,
        schoolName,
        contactName: 'Condition Acceptance Admin',
        email: `condition-acceptance-${suffix}@example.test`,
        conditionType: 'STANDARD',
        planCode: 'BAND_001_025',
        studentCount: 20,
        currentConditionVersion: version,
        expiresAt: new Date(Date.now() + 60 * 60_000),
        status: 'ACCEPTED',
        acceptedAt,
        acceptedContaId: contaId,
        createdByAdminId: 'integration_admin',
      } });
      await prisma.platformSchoolInvitationConditionVersion.create({ data: {
        invitationId,
        version,
        snapshot: { conditionType: 'STANDARD', studentCount: 20 },
        createdBy: 'integration_admin',
      } });
      await prisma.financeProfile.create({ data: {
        contaId,
        onboardingStudentCount: 20,
        wizardCompletedAt: new Date(),
      } });

      const accept = (userId: string) => prisma.$transaction((tx) => acceptInvitationCondition({
        tx,
        contaId,
        userId,
        version,
        selectedStudentCount: 20,
      }));

      const results = await Promise.all([accept(`admin_a_${suffix}`), accept(`admin_b_${suffix}`)]);
      expect(results).toHaveLength(2);
      expect(results.every((result) => result.kind === 'ACCEPTED')).toBe(true);
      expect(results.map((result) => result.kind === 'ACCEPTED' ? result.alreadyAccepted : null).sort()).toEqual([false, true]);

      const persisted = await prisma.platformSchoolInvitationConditionAcceptance.findMany({
        where: { invitationId, version, contaId, selectedStudentCount: 20 },
      });
      const history = await prisma.platformSchoolInvitationHistory.findMany({
        where: { invitationId, action: 'CONDITION_ACCEPTED' },
      });
      expect(persisted).toHaveLength(1);
      const target = resolveSchoolCommercialTarget(20);
      expect(target?.kind).toBe('SELF_SERVICE');
      if (target?.kind !== 'SELF_SERVICE') throw new Error('Expected the accepted student estimate to resolve to a self-service band');
      expect(persisted[0]).toMatchObject({
        invitationId, version, contaId, selectedStudentCount: 20,
        selectedPlanCode: target.band.code, selectedMonthlyAmountCents: target.band.amountCents,
      });
      expect(history).toHaveLength(1);
      expect(history[0]?.after).toMatchObject({ version, contaId, selectedStudentCount: 20, selectedPlanCode: target.band.code, selectedMonthlyAmountCents: target.band.amountCents });
    } finally {
      await prisma.$transaction(async (tx) => {
        // Agreement versions are immutable by design; the local-test-only
        // teardown bypasses that trigger for this isolated disposable fixture.
        await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
        await tx.platformSchoolInvitationConditionAcceptance.deleteMany({ where: { invitationId } });
        await tx.platformSchoolInvitationHistory.deleteMany({ where: { invitationId } });
        await tx.platformSchoolInvitationConditionVersion.deleteMany({ where: { invitationId } });
        await tx.platformSchoolInvitation.deleteMany({ where: { id: invitationId } });
        await tx.financeProfile.deleteMany({ where: { contaId } });
        await tx.conta.deleteMany({ where: { id: contaId } });
      });
    }
  }, 30_000);
});
