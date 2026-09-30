import prisma from '@/lib/prisma';

/** Platform job only: enumerate tenant IDs, then process each tenant in its own RLS context. */
export async function listTenantIdsForUploadCleanup() {
  return prisma.conta.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
}
