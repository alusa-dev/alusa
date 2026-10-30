import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

const databaseName = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '') : '';
const prisma = new PrismaClient();

afterAll(async () => { await prisma.$disconnect(); });

describe.skipIf(databaseName !== 'alusa_test')('school invitation resend-key ledger PostgreSQL integration', () => {
  it('persists one fingerprint per invitation and rejects duplicate claims', async () => {
    const suffix = randomUUID().replaceAll('-', '');
    const invitationId = `school_invitation_ledger_${suffix}`;
    const fingerprint = 'a'.repeat(64);
    try {
      await prisma.platformSchoolInvitation.create({
        data: {
          id: invitationId,
          tokenHash: `token_${suffix}`,
          requestIdempotencyKey: `request_${suffix}`,
          schoolName: 'Resend ledger fixture',
          contactName: 'Admin test',
          email: `${suffix}@example.test`,
          planCode: 'BAND_001_025',
          studentCount: 20,
          expiresAt: new Date(Date.now() + 60 * 60_000),
          createdByAdminId: 'admin_test',
        },
      });
      const claim = { invitationId, requestKeyFingerprint: fingerprint };
      await prisma.platformSchoolInvitationResendRequest.create({ data: claim });
      await expect(prisma.platformSchoolInvitationResendRequest.findUnique({ where: { invitationId_requestKeyFingerprint: claim } }))
        .resolves.toMatchObject(claim);
      await expect(prisma.platformSchoolInvitationResendRequest.create({ data: claim })).rejects.toMatchObject({ code: 'P2002' });
    } finally {
      await prisma.platformSchoolInvitationResendRequest.deleteMany({ where: { invitationId } });
      await prisma.platformSchoolInvitation.deleteMany({ where: { id: invitationId } });
    }
  }, 30_000);
});
