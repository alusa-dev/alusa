import bcrypt from 'bcryptjs';
import type { AdminRole } from '@alusa/admin-auth';
import { prisma } from '@alusa/database';

export type AdminUserRow = {
  id: string;
  username: string;
  email: string | null;
  role: AdminRole;
  status: 'ACTIVE' | 'DISABLED';
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  elevationCount: number;
};

const adminUserSelect = {
  id: true,
  username: true,
  email: true,
  role: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { temporaryElevations: true } },
} as const;

export async function listAdminUsers(): Promise<AdminUserRow[]> {
  const users = await prisma.adminUser.findMany({ select: adminUserSelect, orderBy: [{ status: 'asc' }, { username: 'asc' }] });
  return users.map((user) => ({ ...user, elevationCount: user._count.temporaryElevations }));
}

export async function createAdminUser(input: { username: string; email?: string | null; password: string; role: AdminRole }) {
  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await prisma.adminUser.create({
    data: { username: input.username.trim(), email: input.email?.trim() || null, passwordHash, role: input.role },
    select: adminUserSelect,
  });
  return { ...user, elevationCount: user._count.temporaryElevations };
}

export async function updateAdminUser(input: { id: string; role?: AdminRole; status?: 'ACTIVE' | 'DISABLED' }) {
  const user = await prisma.adminUser.update({
    where: { id: input.id },
    data: { role: input.role, status: input.status },
    select: adminUserSelect,
  });
  return { ...user, elevationCount: user._count.temporaryElevations };
}
