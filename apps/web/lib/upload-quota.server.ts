import 'server-only';
import { randomUUID } from 'node:crypto';
import { runWithTenant } from '@/lib/prisma-tenant';

const configuredDailyLimit = Number(process.env.TENANT_DAILY_UPLOAD_QUOTA_BYTES ?? 100 * 1024 * 1024);
const DAILY_UPLOAD_LIMIT_BYTES = Number.isSafeInteger(configuredDailyLimit) && configuredDailyLimit > 0
  ? configuredDailyLimit
  : 100 * 1024 * 1024;
const RESERVATION_TTL_MS = 15 * 60 * 1000;

function utcDayStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function reserveTenantUpload(contaId: string, fileSize: number, contentType: string, requestedObjectKey?: string, createdByUserId?: string) {
  if (!Number.isSafeInteger(fileSize) || fileSize < 1 || fileSize > DAILY_UPLOAD_LIMIT_BYTES) {
    return { ok: false as const, reason: 'QUOTA_EXCEEDED' as const };
  }
  const periodStart = utcDayStart();
  const id = randomUUID();
  const objectKey = requestedObjectKey ?? `uploads/pending/${contaId}/${id}`;
  const reservation = await runWithTenant(contaId, async (tx) => {
    const quota = await tx.tenantUploadQuota.upsert({
      where: { contaId_periodStart: { contaId, periodStart } },
      create: { contaId, periodStart },
      update: {},
    });
    const changed = await tx.$executeRaw`
      UPDATE "TenantUploadQuota"
      SET "reservedBytes" = "reservedBytes" + ${BigInt(fileSize)}, "updatedAt" = NOW()
      WHERE "id" = ${quota.id}
        AND "usedBytes" + "reservedBytes" + ${BigInt(fileSize)} <= ${BigInt(DAILY_UPLOAD_LIMIT_BYTES)}
    `;
    if (changed !== 1) return null;
    return tx.tenantUploadReservation.create({
      data: {
        id, contaId, createdByUserId, quotaId: quota.id, objectKey, expectedSize: BigInt(fileSize), contentType,
        expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
      },
    });
  });
  if (!reservation) {
    console.warn('[upload-quota][rejected]', { contaId, requestedBytes: fileSize });
    return { ok: false as const, reason: 'QUOTA_EXCEEDED' as const };
  }
  console.info('[upload-quota][reserved]', { contaId, reservationId: reservation.id, requestedBytes: fileSize });
  return { ok: true as const, reservation, expiresInSeconds: RESERVATION_TTL_MS / 1000 };
}

export async function getTenantUploadReservation(contaId: string, reservationId: string) {
  return runWithTenant(contaId, (tx) => tx.tenantUploadReservation.findFirst({ where: { id: reservationId, contaId } }));
}

export async function completeTenantUpload(contaId: string, reservationId: string, actualSize: number, finalObjectKey?: string) {
  return runWithTenant(contaId, async (tx) => {
    const item = await tx.tenantUploadReservation.findFirst({ where: { id: reservationId, contaId, status: 'PENDING', expiresAt: { gt: new Date() } } });
    if (!item || !Number.isSafeInteger(actualSize) || actualSize < 1 || BigInt(actualSize) > item.expectedSize) return false;
    const changed = await tx.tenantUploadReservation.updateMany({ where: { id: item.id, contaId, status: 'PENDING' }, data: { status: 'COMPLETED', completedAt: new Date(), finalObjectKey: finalObjectKey ?? null } });
    if (changed.count !== 1) return false;
    await tx.tenantUploadQuota.update({ where: { id: item.quotaId, contaId }, data: { reservedBytes: { decrement: item.expectedSize }, usedBytes: { increment: BigInt(actualSize) } } });
    console.info('[upload-quota][committed]', { contaId, reservationId, committedBytes: actualSize });
    return true;
  });
}

export async function releaseTenantUpload(contaId: string, reservationId: string, status: 'CANCELLED' | 'EXPIRED' = 'CANCELLED') {
  return runWithTenant(contaId, async (tx) => {
    const item = await tx.tenantUploadReservation.findFirst({ where: { id: reservationId, contaId, status: 'PENDING' } });
    if (!item) return false;
    const changed = await tx.tenantUploadReservation.updateMany({ where: { id: item.id, contaId, status: 'PENDING' }, data: { status } });
    if (changed.count !== 1) return false;
    await tx.tenantUploadQuota.update({ where: { id: item.quotaId, contaId }, data: { reservedBytes: { decrement: item.expectedSize } } });
    console.info('[upload-quota][released]', { contaId, reservationId, status });
    return true;
  });
}

export async function expireTenantUploadReservations(contaId: string) {
  return runWithTenant(contaId, async (tx) => {
    const now = new Date();
    const expired = await tx.tenantUploadReservation.findMany({ where: { contaId, status: 'PENDING', expiresAt: { lte: now } }, select: { id: true, objectKey: true, quotaId: true, expectedSize: true } });
    const objectKeys: string[] = [];
    for (const item of expired) {
      const changed = await tx.tenantUploadReservation.updateMany({ where: { id: item.id, contaId, status: 'PENDING' }, data: { status: 'EXPIRED' } });
      if (!changed.count) continue;
      await tx.tenantUploadQuota.update({
        where: { id: item.quotaId, contaId },
        data: { reservedBytes: { decrement: item.expectedSize } },
      });
      objectKeys.push(item.objectKey);
    }
    return objectKeys;
  });
}


export async function withTenantUploadQuota<T>(params: {
  contaId: string; fileSize: number; contentType: string; objectKey: string;
  action: (reservationId: string) => Promise<T>;
  cleanup: () => Promise<void>;
}) {
  const reserved = await reserveTenantUpload(params.contaId, params.fileSize, params.contentType, params.objectKey);
  if (!reserved.ok) return { ok: false as const };
  try {
    const result = await params.action(reserved.reservation.id);
    const completed = await completeTenantUpload(params.contaId, reserved.reservation.id, params.fileSize);
    if (!completed) throw new Error('Upload quota reservation could not be finalized.');
    return { ok: true as const, result };
  } catch (error) {
    await Promise.allSettled([params.cleanup(), releaseTenantUpload(params.contaId, reserved.reservation.id)]);
    throw error;
  }
}
