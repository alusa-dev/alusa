import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

const databaseIsLocalTest = (() => {
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
const prisma = databaseIsLocalTest ? new PrismaClient() : null;

afterAll(async () => {
  await prisma?.$disconnect();
});

describe.skipIf(!databaseIsLocalTest)('FinanceProfile onboarding student count database constraint', () => {
  it('permits legacy NULL and positive counts, and rejects zero or negative values', async () => {
    const db = prisma as PrismaClient;
    const contaId = `pricing_count_${randomUUID().replaceAll('-', '')}`;
    await db.conta.create({ data: { id: contaId, nome: 'Pricing count constraint fixture' } });

    try {
      const profile = await db.financeProfile.create({
        data: { contaId, onboardingStudentCount: null },
        select: { id: true, onboardingStudentCount: true },
      });
      expect(profile.onboardingStudentCount).toBeNull();

      await db.financeProfile.update({
        where: { id: profile.id },
        data: { onboardingStudentCount: 1 },
      });
      await expect(db.financeProfile.update({
        where: { id: profile.id },
        data: { onboardingStudentCount: 0 },
      })).rejects.toThrow(/FinanceProfile_onboardingStudentCount_positive_check/);
      await expect(db.financeProfile.update({
        where: { id: profile.id },
        data: { onboardingStudentCount: -1 },
      })).rejects.toThrow(/FinanceProfile_onboardingStudentCount_positive_check/);

      await expect(db.financeProfile.findUniqueOrThrow({
        where: { id: profile.id },
        select: { onboardingStudentCount: true },
      })).resolves.toEqual({ onboardingStudentCount: 1 });
    } finally {
      await db.conta.delete({ where: { id: contaId } });
    }
  });
});
