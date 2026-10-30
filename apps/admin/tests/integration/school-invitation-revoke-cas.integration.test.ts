import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

const databaseName = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '') : '';
const isTestDatabase = databaseName === 'alusa_test';
const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!isTestDatabase)('school invitation revoke compare-and-set PostgreSQL race', () => {
  it('allows exactly one of concurrent accept and revoke transitions to win', async () => {
    const suffix = randomUUID().replaceAll('-', '');
    const contaId = `school_invitation_cas_${suffix}`;
    const invitationId = `school_invitation_${suffix}`;
    try {
      await prisma.conta.create({ data: { id: contaId, nome: 'CAS integration fixture', updatedAt: new Date() } });
      const invitation = await prisma.platformSchoolInvitation.create({ data: {
        id: invitationId,
        tokenHash: `token_${suffix}`,
        requestIdempotencyKey: `request_${suffix}`,
        schoolName: 'CAS integration fixture',
        contactName: 'Admin test',
        email: `${suffix}@example.test`,
        planCode: 'BAND_001_025',
        studentCount: 20,
        expiresAt: new Date(Date.now() + 60 * 60_000),
        createdByAdminId: 'admin_test',
      } });
      const [accepted, revoked] = await Promise.all([
        prisma.platformSchoolInvitation.updateMany({
          where: { id: invitation.id, status: 'PENDING' },
          data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedContaId: contaId },
        }),
        prisma.platformSchoolInvitation.updateMany({
          where: { id: invitation.id, status: 'PENDING' },
          data: { status: 'REVOKED', revokedAt: new Date() },
        }),
      ]);

      expect(accepted.count + revoked.count).toBe(1);
      const persisted = await prisma.platformSchoolInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
      expect(['ACCEPTED', 'REVOKED']).toContain(persisted.status);
      expect(persisted.status === 'ACCEPTED' ? accepted.count : revoked.count).toBe(1);
    } finally {
      await prisma.platformSchoolInvitation.deleteMany({ where: { id: invitationId } });
      await prisma.conta.deleteMany({ where: { id: contaId } });
    }
  }, 30_000);
});
