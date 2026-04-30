import { type Usuario } from '@prisma/client';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';

export type AuthFailureReason =
  | 'INVALID_INPUT'
  | 'USER_NOT_FOUND'
  | 'USER_INACTIVE'
  | 'ACCOUNT_DEACTIVATED'
  | 'ACCOUNT_UNAVAILABLE'
  | 'INVALID_PASSWORD'
  | 'UNEXPECTED_ERROR';

export type AuthUser = {
  id: string;
  email: string;
  nome: string;
  role: string;
  contaId?: string;
  emailVerifiedAt: Date | null;
};

export type VerifyCredentialsDetailedResult =
  | { ok: true; user: AuthUser }
  | { ok: false; reason: AuthFailureReason };

export type SessionAccessResult =
  | { ok: true; emailVerified: boolean; contaId: string; role: string }
  | { ok: false; reason: 'USER_INACTIVE' | 'ACCOUNT_DEACTIVATED' | 'ACCOUNT_UNAVAILABLE' };

function isAccountDeactivated(status: string | null | undefined, deletedAt: Date | null | undefined): boolean {
  return Boolean(deletedAt) || (typeof status === 'string' && status.toUpperCase() !== 'ATIVO');
}

async function resolveUserContaAccess(input: {
  userId: string;
  preferredContaId?: string | null;
  legacyContaId?: string | null;
  legacyRole?: string | null;
}) {
  const db = prisma as unknown as {
    usuarioConta?: {
      findFirst: (_args: unknown) => Promise<{
        contaId: string;
        role: string;
        conta?: { status?: string | null; deletedAt?: Date | null } | null;
      } | null>;
      updateMany?: (_args: unknown) => Promise<unknown>;
    };
  };

  const activeMembershipWhere = (contaId?: string | null) => ({
    usuarioId: input.userId,
    status: 'ATIVO',
    ...(contaId ? { contaId } : {}),
  });

  if (db.usuarioConta?.findFirst) {
    const preferredContaId = input.preferredContaId?.trim() || null;
    const legacyContaId = input.legacyContaId?.trim() || null;
    const contaOrder = preferredContaId ? [preferredContaId] : legacyContaId ? [legacyContaId] : [];

    for (const contaId of contaOrder) {
      const membership = await db.usuarioConta.findFirst({
        where: activeMembershipWhere(contaId),
        select: {
          contaId: true,
          role: true,
          conta: { select: { status: true, deletedAt: true } },
        },
      });

      if (membership) {
        if (isAccountDeactivated(membership.conta?.status, membership.conta?.deletedAt)) {
          return { ok: false as const, reason: 'ACCOUNT_DEACTIVATED' as const };
        }
        return { ok: true as const, contaId: membership.contaId, role: membership.role };
      }
    }

    if (!preferredContaId) {
      const membership = await db.usuarioConta.findFirst({
        where: activeMembershipWhere(),
        orderBy: [{ lastAccessedAt: 'desc' }, { createdAt: 'asc' }],
        select: {
          contaId: true,
          role: true,
          conta: { select: { status: true, deletedAt: true } },
        },
      });

      if (membership) {
        if (isAccountDeactivated(membership.conta?.status, membership.conta?.deletedAt)) {
          return { ok: false as const, reason: 'ACCOUNT_DEACTIVATED' as const };
        }
        return { ok: true as const, contaId: membership.contaId, role: membership.role };
      }
    }
  }

  const legacyContaId = input.legacyContaId?.trim();
  if (!legacyContaId) {
    return { ok: false as const, reason: 'ACCOUNT_UNAVAILABLE' as const };
  }

  const conta = await prisma.conta.findUnique({
    where: { id: legacyContaId },
    select: { status: true, deletedAt: true },
  });

  if (!conta) {
    return { ok: false as const, reason: 'ACCOUNT_UNAVAILABLE' as const };
  }

  const contaStatus = conta.status ? String(conta.status).toUpperCase() : null;
  if (isAccountDeactivated(contaStatus, conta.deletedAt)) {
    return { ok: false as const, reason: 'ACCOUNT_DEACTIVATED' as const };
  }

  return {
    ok: true as const,
    contaId: legacyContaId,
    role: input.legacyRole ?? 'RESPONSAVEL',
  };
}

export async function resolveSessionAccess(input: {
  userId?: string | null;
  contaId?: string | null;
}): Promise<SessionAccessResult> {
  const userId = input.userId?.trim();

  if (!userId) {
    return { ok: false, reason: 'ACCOUNT_UNAVAILABLE' };
  }

  const user = await prisma.usuario.findUnique({
    where: { id: userId },
    select: { id: true, status: true, contaId: true, role: true, emailVerifiedAt: true },
  });

  if (!user) {
    return { ok: false, reason: 'ACCOUNT_UNAVAILABLE' };
  }

  if (user.status && String(user.status).toUpperCase() !== 'ATIVO') {
    return { ok: false, reason: 'USER_INACTIVE' };
  }

  const access = await resolveUserContaAccess({
    userId: user.id,
    preferredContaId: input.contaId,
    legacyContaId: user.contaId,
    legacyRole: user.role,
  });
  if (!access.ok) {
    return access;
  }

  return {
    ok: true,
    emailVerified: Boolean(user.emailVerifiedAt),
    contaId: access.contaId,
    role: access.role,
  };
}

export async function verifyCredentialsDetailed(
  email: string,
  password: string,
  preferredContaId?: string | null,
): Promise<VerifyCredentialsDetailedResult> {
  const inputEmail = email.trim();

  if (!inputEmail || !password) {
    return { ok: false, reason: 'INVALID_INPUT' };
  }

  try {
    type SelectedUser = Pick<Usuario, 'id' | 'email' | 'nome' | 'role' | 'senhaHash' | 'status' | 'contaId' | 'emailVerifiedAt'>;
    const user: SelectedUser | null = await prisma.usuario.findFirst({
      where: { email: { equals: inputEmail, mode: 'insensitive' } },
      select: { id: true, email: true, nome: true, role: true, senhaHash: true, status: true, contaId: true, emailVerifiedAt: true }
    });
    if (!user) {
      if (process.env.AUTH_DEBUG === 'true') console.debug('[auth] user not found', { email: inputEmail });
      return { ok: false, reason: 'USER_NOT_FOUND' };
    }

    if (user.status && String(user.status).toUpperCase() !== 'ATIVO') {
      if (process.env.AUTH_DEBUG === 'true') console.debug('[auth] user inactive', { email: inputEmail, status: (user as unknown as { status?: string }).status });
      return { ok: false, reason: 'USER_INACTIVE' };
    }

    const pepper = process.env.BCRYPT_PEPPER || '';
    let ok = await bcrypt.compare(password + pepper, user.senhaHash);
    if (!ok && process.env.NODE_ENV !== 'production') {
      ok = await bcrypt.compare(password, user.senhaHash);
      if (process.env.AUTH_DEBUG === 'true') console.debug('[auth] pepper mismatch? tried without pepper', { email: inputEmail, ok });
    }
    if (!ok) {
      if (process.env.AUTH_DEBUG === 'true') console.debug('[auth] invalid password', { email: inputEmail });
      return { ok: false, reason: 'INVALID_PASSWORD' };
    }

    const access = await resolveUserContaAccess({
      userId: user.id,
      preferredContaId,
      legacyContaId: user.contaId,
      legacyRole: user.role,
    });
    if (!access.ok) {
      if (process.env.AUTH_DEBUG === 'true') {
        console.debug('[auth] conta access unavailable', {
          email: inputEmail,
          contaId: preferredContaId ?? user.contaId,
          reason: access.reason,
        });
      }
      return { ok: false, reason: access.reason };
    }

    return {
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        nome: user.nome,
        role: access.role,
        contaId: access.contaId,
        emailVerifiedAt: user.emailVerifiedAt,
      },
    };
  } catch {
    return { ok: false, reason: 'UNEXPECTED_ERROR' };
  }
}

// verifyCredentials: busca em Usuario e valida senha
export async function verifyCredentials(email: string, password: string): Promise<AuthUser | null> {
  const result = await verifyCredentialsDetailed(email, password);
  return result.ok ? result.user : null;
}
