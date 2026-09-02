import bcrypt from 'bcryptjs';
import { prisma } from '@alusa/database';
import { hasAdminPermission } from './roles';
import type { AdminPermission, AdminRole } from './roles';

export type AuthenticatedAdminUser = {
  id: string;
  username: string;
  email: string | null;
  role: AdminRole;
  status: 'ACTIVE' | 'DISABLED';
};

export async function authenticateAdminUser(input: { username: string; password: string }): Promise<AuthenticatedAdminUser | null> {
  const subject = input.username.trim();
  const user = await prisma.adminUser.findFirst({
    where: { OR: [{ username: { equals: subject, mode: 'insensitive' } }, { email: { equals: subject, mode: 'insensitive' } }] },
    select: { id: true, username: true, email: true, role: true, status: true, passwordHash: true },
  });
  if (!user || user.status !== 'ACTIVE' || !(await bcrypt.compare(input.password, user.passwordHash))) return null;
  await prisma.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return { id: user.id, username: user.username, email: user.email, role: user.role, status: user.status };
}

export async function getAdminUserForSession(adminUserId: string) {
  const user = await prisma.adminUser.findUnique({
    where: { id: adminUserId },
    select: {
      id: true, username: true, email: true, role: true, status: true,
      temporaryElevations: { where: { revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, expiresAt: true, permissions: true }, orderBy: { expiresAt: 'desc' } },
    },
  });
  if (!user || user.status !== 'ACTIVE') return null;
  return { ...user, elevatedPermissions: user.temporaryElevations.flatMap((elevation) => elevation.permissions) };
}

export function canAdminUser(user: { role: AdminRole; elevatedPermissions: readonly string[] }, permission: AdminPermission) {
  return hasAdminPermission(user.role, permission, user.elevatedPermissions);
}
