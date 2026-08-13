import { type Usuario } from '@prisma/client';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';

const DUMMY_PASSWORD_HASH =
  process.env.AUTH_DUMMY_PASSWORD_HASH ??
  '$2a$10$Se0.WsOCmOQjfLr0.wqvoe7Q2zlq0fSkzIF5ygArAqBpQRKDcgrRi';

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
  sessionVersion: number;
};

export type VerifyCredentialsDetailedResult =
  | { ok: true; user: AuthUser }
  | { ok: false; reason: AuthFailureReason };

export type SessionAccessResult =
  | { ok: true; emailVerified: boolean; contaId: string; role: string; sessionVersion: number }
  | { ok: false; reason: 'USER_INACTIVE' | 'ACCOUNT_DEACTIVATED' | 'ACCOUNT_UNAVAILABLE' | 'SESSION_REVOKED' };

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
  sessionVersion?: number | null;
}): Promise<SessionAccessResult> {
  const userId = input.userId?.trim();

  if (!userId) {
    return { ok: false, reason: 'ACCOUNT_UNAVAILABLE' };
  }

  const user = await prisma.usuario.findUnique({
    where: { id: userId },
    select: { id: true, status: true, contaId: true, role: true, emailVerifiedAt: true, sessionVersion: true },
  });

  if (!user) {
    return { ok: false, reason: 'ACCOUNT_UNAVAILABLE' };
  }

  if (user.status && String(user.status).toUpperCase() !== 'ATIVO') {
    return { ok: false, reason: 'USER_INACTIVE' };
  }

  // JWTs sem versão são anteriores ao mecanismo de revogação e devem ser
  // reautenticados; aceitar o valor ausente manteria tokens antigos válidos.
  if (input.sessionVersion !== user.sessionVersion) {
    return { ok: false, reason: 'SESSION_REVOKED' };
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
    sessionVersion: user.sessionVersion,
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
    type SelectedUser = Pick<Usuario, 'id' | 'email' | 'nome' | 'role' | 'senhaHash' | 'status' | 'contaId' | 'emailVerifiedAt' | 'sessionVersion'>;
    const user: SelectedUser | null = await prisma.usuario.findFirst({
      where: { email: { equals: inputEmail, mode: 'insensitive' } },
      select: { id: true, email: true, nome: true, role: true, senhaHash: true, status: true, contaId: true, emailVerifiedAt: true, sessionVersion: true }
    });
    if (!user) {
      // Equaliza o custo do caminho "usuário inexistente" para reduzir enumeração por timing.
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      if (process.env.AUTH_DEBUG === 'true') console.debug('[auth] user not found', { email: inputEmail });
      return { ok: false, reason: 'USER_NOT_FOUND' };
    }

    const pepper = process.env.BCRYPT_PEPPER || '';
    let ok = await bcrypt.compare(password + pepper, user.senhaHash);
    if (!ok && process.env.NODE_ENV !== 'production') {
      ok = await bcrypt.compare(password, user.senhaHash);
      if (process.env.AUTH_DEBUG === 'true') console.debug('[auth] pepper mismatch? tried without pepper', { email: inputEmail, ok });
    }

    if (user.status && String(user.status).toUpperCase() !== 'ATIVO') {
      if (process.env.AUTH_DEBUG === 'true') console.debug('[auth] user inactive', { email: inputEmail, status: (user as unknown as { status?: string }).status });
      return { ok: false, reason: 'USER_INACTIVE' };
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
        sessionVersion: user.sessionVersion,
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
