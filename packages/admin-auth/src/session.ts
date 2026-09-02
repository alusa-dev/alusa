import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@alusa/database';

export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 8;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createAdminSession(input: { adminUserId: string; ip?: string | null; userAgent?: string | null }) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_TTL_SECONDS * 1000);
  await prisma.adminSession.create({ data: { adminUserId: input.adminUserId, tokenHash: hashToken(token), expiresAt, ip: input.ip ?? null, userAgent: input.userAgent ?? null } });
  return { token, expiresAt };
}

export async function getAdminSession(token: string | null | undefined) {
  if (!token) return null;
  const session = await prisma.adminSession.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true, adminUserId: true, expiresAt: true, createdAt: true, revokedAt: true,
      adminUser: { select: { id: true, username: true, email: true, role: true, status: true, temporaryElevations: { where: { revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, expiresAt: true, permissions: true }, orderBy: { expiresAt: 'desc' } } } },
    },
  });
  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now() || session.adminUser.status !== 'ACTIVE') return null;
  await prisma.adminSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  const elevatedPermissions = session.adminUser.temporaryElevations.flatMap((elevation) => elevation.permissions);
  const elevatedUntil = session.adminUser.temporaryElevations[0]?.expiresAt ?? null;
  return {
    id: session.id, adminUserId: session.adminUserId, username: session.adminUser.username, email: session.adminUser.email,
    role: session.adminUser.role, elevatedPermissions, elevatedUntil, createdAt: session.createdAt, expiresAt: session.expiresAt,
  };
}

export async function revokeAdminSession(token: string | null | undefined) {
  if (!token) return;
  await prisma.adminSession.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
}
