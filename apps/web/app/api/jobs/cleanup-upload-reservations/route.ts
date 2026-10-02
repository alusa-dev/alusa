import { NextResponse } from 'next/server';
import { deleteStorageObject } from '@/lib/r2-storage';
import { releaseTenantUpload } from '@/lib/upload-quota.server';
import { runWithTenant } from '@/lib/prisma-tenant';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { listTenantIdsForUploadCleanup } from '@/src/server/uploads/upload-cleanup.service';
import { logJobResult } from '@/src/server/jobs/job-observability';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const scope = await resolveTenantScope(request, {
    allowCron: true,
    requestedContaId: url.searchParams.get('contaId'),
  });
  if (!scope.ok) return scope.response;

  const tenants = scope.contaId ? [{ id: scope.contaId }] : await listTenantIdsForUploadCleanup();
  const startedAt = Date.now();
  let released = 0;
  let deleteFailures = 0;
  let scanned = 0;
  for (const tenant of tenants) {
    const expired = await runWithTenant(tenant.id, (tx) =>
      tx.tenantUploadReservation.findMany({
        where: {
          contaId: tenant.id,
          OR: [
            { status: 'PENDING', expiresAt: { lte: new Date() } },
            { status: 'COMPLETED', finalObjectKey: { not: null }, pendingCleanedAt: null },
          ],
        },
        orderBy: { expiresAt: 'asc' },
        take: 100,
        select: { id: true, contaId: true, objectKey: true, status: true, finalObjectKey: true },
      }),
    );
    scanned += expired.length;
    for (const item of expired) {
      try {
        if (item.status === 'PENDING') {
          await deleteStorageObject(item.objectKey);
          await deleteStorageObject(
            item.finalObjectKey ?? `uploads/confirmed/${item.contaId}/${item.id}`,
          );
        } else if (
          item.finalObjectKey &&
          item.objectKey !== item.finalObjectKey &&
          item.objectKey.startsWith(`uploads/pending/${tenant.id}/`)
        ) {
          await deleteStorageObject(item.objectKey);
        }
      } catch {
        deleteFailures += 1;
        continue;
      }
      if (item.status === 'PENDING') {
        const changed = await releaseTenantUpload(tenant.id, item.id, 'EXPIRED');
        if (changed) released += 1;
      } else {
        await runWithTenant(tenant.id, (tx) =>
          tx.tenantUploadReservation.updateMany({
            where: { id: item.id, contaId: tenant.id, status: 'COMPLETED', pendingCleanedAt: null },
            data: { pendingCleanedAt: new Date() },
          }),
        );
        released += 1;
      }
    }
  }
  logJobResult('cleanup-upload-reservations', startedAt, {
    processed: scanned,
    updated: released,
    failed: deleteFailures,
  });
  return NextResponse.json(
    { scanned, released, deleteFailures },
    { headers: { 'cache-control': 'no-store' } },
  );
}
