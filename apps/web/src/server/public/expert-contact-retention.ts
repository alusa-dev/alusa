import { prisma } from '@/lib/prisma';

const PII_RETENTION_DAYS = 30;

/** Redacts unresolved public leads after the reconciliation window, without making them retryable. */
export async function redactExpiredExpertContactLeadPii(now = new Date()): Promise<{ redacted: number; cutoff: Date }> {
  const cutoff = new Date(now.getTime() - PII_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const cutoffFilter = { createdAt: { lt: cutoff } };
  const unresolved = await prisma.expertContactLeadDelivery.updateMany({
    where: {
      ...cutoffFilter,
      state: { in: ['PENDING', 'NOTE_CREATING'] },
    },
    data: {
      state: 'EXPIRED',
      contactName: null,
      email: null,
      institutionName: null,
      institutionWebsite: null,
      phone: null,
      institutionType: null,
      studentsRange: null,
      payloadHash: null,
    },
  });
  const deliveredHashes = await prisma.expertContactLeadDelivery.updateMany({
    where: { ...cutoffFilter, state: 'DELIVERED', payloadHash: { not: null } },
    data: { payloadHash: null },
  });
  return { redacted: unresolved.count + deliveredHashes.count, cutoff };
}
