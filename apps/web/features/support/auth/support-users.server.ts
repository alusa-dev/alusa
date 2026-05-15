import bcrypt from 'bcryptjs';
import type { SupportRole } from '@prisma/client';

import prisma from '@/lib/prisma';
import { getGlobalAdminAuthConfig, validateGlobalAdminCredentials } from '@/features/global-admin/auth/credentials.server';

export async function authenticateSupportUser(input: { username: string; password: string }) {
  const username = input.username.trim();
  const user = await prisma.supportUser.findFirst({
    where: {
      OR: [
        { username: { equals: username, mode: 'insensitive' } },
        { email: { equals: username, mode: 'insensitive' } },
      ],
    },
  });

  if (user) {
    if (user.status !== 'ACTIVE') return null;
    if (user.role === 'BREAK_GLASS') {
      const expiresAt = user.breakGlassExpiresAt?.getTime() ?? 0;
      if (expiresAt <= Date.now()) return null;
    }

    const valid = await bcrypt.compare(input.password, user.passwordHash);
    if (valid) {
      await prisma.supportUser.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      return {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      };
    }

    if (!validateGlobalAdminCredentials(input)) return null;

    const passwordHash = await bcrypt.hash(input.password, 12);
    await prisma.supportUser.update({
      where: { id: user.id },
      data: { passwordHash, lastLoginAt: new Date() },
    });

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    };
  }

  getGlobalAdminAuthConfig();
  if (!validateGlobalAdminCredentials(input)) return null;

  const passwordHash = await bcrypt.hash(input.password, 12);
  const fallbackUser = await prisma.supportUser.create({
    data: {
      username,
      passwordHash,
      role: 'SUPPORT_ADMIN',
      lastLoginAt: new Date(),
    },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
    },
  });

  return {
    id: fallbackUser.id,
    username: fallbackUser.username,
    email: fallbackUser.email,
    role: fallbackUser.role,
  };
}

export async function listSupportUsers() {
  return prisma.supportUser.findMany({
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      status: true,
      breakGlassExpiresAt: true,
      lastLoginAt: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [{ status: 'asc' }, { username: 'asc' }],
  });
}

export async function createSupportUser(input: {
  username: string;
  email?: string | null;
  password: string;
  role: SupportRole;
  breakGlassExpiresAt?: Date | null;
}) {
  const passwordHash = await bcrypt.hash(input.password, 12);
  return prisma.supportUser.create({
    data: {
      username: input.username.trim(),
      email: input.email?.trim() || null,
      passwordHash,
      role: input.role,
      breakGlassExpiresAt: input.role === 'BREAK_GLASS' ? input.breakGlassExpiresAt ?? null : null,
    },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      status: true,
      breakGlassExpiresAt: true,
      createdAt: true,
    },
  });
}

export async function updateSupportUser(input: {
  id: string;
  role?: SupportRole;
  status?: 'ACTIVE' | 'DISABLED';
  breakGlassExpiresAt?: Date | null;
}) {
  return prisma.supportUser.update({
    where: { id: input.id },
    data: {
      role: input.role,
      status: input.status,
      breakGlassExpiresAt: input.breakGlassExpiresAt,
    },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      status: true,
      breakGlassExpiresAt: true,
      updatedAt: true,
    },
  });
}
