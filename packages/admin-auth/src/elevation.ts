import { prisma } from '@alusa/database';
import { ADMIN_PERMISSIONS } from './roles';

const MAX_ELEVATION_HOURS = 24;

function assertElevationInput(input: { reason: string; expiresAt: Date; permissions: readonly string[] }) {
  const reason = input.reason.trim();
  if (reason.length < 10) throw new Error('Elevação temporária exige um motivo detalhado.');
  if (input.expiresAt.getTime() <= Date.now()) throw new Error('Elevação temporária exige expiração futura.');
  if (input.expiresAt.getTime() > Date.now() + MAX_ELEVATION_HOURS * 60 * 60 * 1000) {
    throw new Error('Elevação temporária não pode exceder 24 horas.');
  }
  const knownPermissions = new Set<string>(ADMIN_PERMISSIONS);
  if (input.permissions.some((permission) => !knownPermissions.has(permission))) {
    throw new Error('Elevação contém permissão administrativa inválida.');
  }
}

export async function grantTemporaryElevation(input: {
  adminUserId: string;
  grantedByAdminUserId: string;
  reason: string;
  expiresAt: Date;
  permissions: readonly string[];
}) {
  assertElevationInput(input);
  const grantingUser = await prisma.adminUser.findUnique({
    where: { id: input.grantedByAdminUserId },
    select: { status: true, role: true },
  });
  if (!grantingUser || grantingUser.status !== 'ACTIVE' || grantingUser.role !== 'OWNER') {
    throw new Error('Somente um administrador OWNER ativo pode conceder elevação.');
  }
  return prisma.temporaryElevation.create({
    data: {
      adminUserId: input.adminUserId,
      grantedByAdminUserId: input.grantedByAdminUserId,
      reason: input.reason.trim(),
      expiresAt: input.expiresAt,
      permissions: [...new Set(input.permissions)],
    },
  });
}

export async function revokeTemporaryElevation(id: string) {
  return prisma.temporaryElevation.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
