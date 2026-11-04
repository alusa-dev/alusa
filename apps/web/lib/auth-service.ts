import { Prisma, type PrismaClient } from '@prisma/client';
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

export type AuthContext = 'OWNER' | 'COLLABORATOR' | 'PORTAL';

export type AuthUser = {
  id: string;
  email: string;
  nome: string;
  foto?: string | null;
  telefone?: string | null;
  birthDate?: Date | null;
  role: string;
  contaId?: string;
  emailVerifiedAt: Date | null;
  sessionVersion: number;
  authContext: AuthContext;
  availableAccounts: Array<{ id: string; name: string; role?: string }>;
};

export type VerifyCredentialsDetailedResult =
  | { ok: true; user: AuthUser }
  | { ok: false; reason: AuthFailureReason };

export type SessionAccessResult =
  | { ok: true; emailVerified: boolean; contaId: string; role: string; sessionVersion: number; authContext: AuthContext }
  | { ok: false; reason: 'USER_INACTIVE' | 'ACCOUNT_DEACTIVATED' | 'ACCOUNT_UNAVAILABLE' | 'SESSION_REVOKED' };

type SessionRevocationDb = PrismaClient | Prisma.TransactionClient;

/**
 * Revoga todas as sessões JWT de um usuário.
 *
 * O incremento é atômico e, por aceitar um TransactionClient, pode ser usado
 * junto com alterações críticas de credenciais ou de status do usuário.
 */
export async function revokeUserSessions(
  userId: string,
  db: SessionRevocationDb = prisma,
): Promise<number> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    throw new Error('userId é obrigatório para revogar sessões.');
  }

  const revoke = async (tx: Prisma.TransactionClient) => {
    const result = await tx.usuario.updateMany({
      where: { id: normalizedUserId },
      data: { sessionVersion: { increment: 1 } },
    });

    await tx.authCredential.updateMany({
      where: { userId: normalizedUserId },
      data: { sessionVersion: { increment: 1 } },
    });

    const now = new Date();
    await tx.mobileAuthSession.updateMany({
      where: { userId: normalizedUserId, revokedAt: null },
      data: { revokedAt: now, lastUsedAt: now },
    });

    return result.count;
  };

  return db === prisma ? prisma.$transaction(revoke) : revoke(db);
}

function isAccountDeactivated(status: string | null | undefined, deletedAt: Date | null | undefined): boolean {
  return Boolean(deletedAt) || (typeof status === 'string' && status.toUpperCase() !== 'ATIVO');
}

async function resolveUserContaAccess(input: {
  userId: string;
  authContext: AuthContext;
  preferredContaId?: string | null;
}) {
  const preferredContaId = input.preferredContaId?.trim() || null;
  if (input.authContext === 'OWNER') {
    const contas = await prisma.conta.findMany({
      where: { ownerUserId: input.userId, status: 'ATIVO', deletedAt: null, ...(preferredContaId ? { id: preferredContaId } : {}) },
      orderBy: { createdAt: 'asc' },
      select: { id: true, nome: true },
    });
    return contas.length
      ? { ok: true as const, accounts: contas.map(({ id, nome }) => ({ id, name: nome })), role: 'ADMIN' }
      : { ok: false as const, reason: 'ACCOUNT_UNAVAILABLE' as const };
  }

  if (input.authContext === 'PORTAL') {
    const linkedAccounts = await prisma.conta.findMany({
      where: {
        status: 'ATIVO', deletedAt: null,
        ...(preferredContaId ? { id: preferredContaId } : {}),
        OR: [
          { alunos: { some: { usuarioId: input.userId } } },
          { responsaveis: { some: { usuarioId: input.userId } } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, nome: true, alunos: { where: { usuarioId: input.userId }, select: { id: true }, take: 1 }, responsaveis: { where: { usuarioId: input.userId }, select: { id: true }, take: 1 } },
    });
    const accounts = linkedAccounts.map((conta) => ({ id: conta.id, name: conta.nome, role: conta.alunos.length ? 'ALUNO' : 'RESPONSAVEL' }));
    return accounts.length ? { ok: true as const, accounts, role: accounts.find((item) => item.id === preferredContaId)?.role ?? accounts[0].role } : { ok: false as const, reason: 'ACCOUNT_UNAVAILABLE' as const };
  }

  const membership = await prisma.usuarioConta.findFirst({
    where: {
      usuarioId: input.userId,
      status: 'ATIVO',
      role: { not: 'RESPONSAVEL' },
      conta: { status: 'ATIVO', deletedAt: null, ownerUserId: { not: input.userId } },
      ...(preferredContaId ? { contaId: preferredContaId } : {}),
    },
    ...(preferredContaId ? {} : { orderBy: [{ lastAccessedAt: 'desc' as const }, { createdAt: 'asc' as const }] }),
    select: {
      contaId: true,
      role: true,
      conta: { select: { status: true, deletedAt: true } },
      usuario: { select: { nome: true } },
    },
  });

  if (!membership || !membership.conta) return { ok: false as const, reason: 'ACCOUNT_UNAVAILABLE' as const };
  if (isAccountDeactivated(membership.conta?.status, membership.conta?.deletedAt)) {
    return { ok: false as const, reason: 'ACCOUNT_DEACTIVATED' as const };
  }
  const memberships = await prisma.usuarioConta.findMany({
    where: { usuarioId: input.userId, status: 'ATIVO', role: { not: 'RESPONSAVEL' }, conta: { status: 'ATIVO', deletedAt: null, ownerUserId: { not: input.userId } }, ...(preferredContaId ? { contaId: preferredContaId } : {}) },
    orderBy: [{ lastAccessedAt: 'desc' }, { createdAt: 'asc' }],
    select: { contaId: true, role: true, conta: { select: { nome: true } } },
  });
  return { ok: true as const, accounts: memberships.map((item) => ({ id: item.contaId, name: item.conta.nome, role: item.role })), contaId: membership.contaId, role: membership.role };
}

export async function listAuthContextAccounts(userId: string, authContext: AuthContext) {
  const access = await resolveUserContaAccess({ userId, authContext });
  return access.ok ? access.accounts : [];
}

export async function resolveSessionAccess(input: {
  userId?: string | null;
  contaId?: string | null;
  sessionVersion?: number | null;
  authContext?: AuthContext | null;
}): Promise<SessionAccessResult> {
  const userId = input.userId?.trim();

  if (!userId) {
    return { ok: false, reason: 'ACCOUNT_UNAVAILABLE' };
  }

  const authContext = input.authContext;
  if (!authContext) return { ok: false, reason: 'SESSION_REVOKED' };
  const credential = await prisma.authCredential.findUnique({
    where: { uq_auth_credential_context_user: { context: authContext, userId } },
    select: { user: { select: { id: true, status: true } }, emailVerifiedAt: true, sessionVersion: true },
  });

  if (!credential) {
    return { ok: false, reason: 'ACCOUNT_UNAVAILABLE' };
  }

  if (credential.user.status && String(credential.user.status).toUpperCase() !== 'ATIVO') {
    return { ok: false, reason: 'USER_INACTIVE' };
  }

  // JWTs sem versão são anteriores ao mecanismo de revogação e devem ser
  // reautenticados; aceitar o valor ausente manteria tokens antigos válidos.
  if (input.sessionVersion !== credential.sessionVersion) {
    return { ok: false, reason: 'SESSION_REVOKED' };
  }

  const access = await resolveUserContaAccess({
    userId: credential.user.id,
    authContext,
    preferredContaId: input.contaId,
  });
  if (!access.ok) {
    return access;
  }
  if (!input.contaId) return { ok: false, reason: 'ACCOUNT_UNAVAILABLE' };

  return {
    ok: true,
    emailVerified: Boolean(credential.emailVerifiedAt),
    contaId: input.contaId,
    role: access.role,
    sessionVersion: credential.sessionVersion,
    authContext,
  };
}

export async function verifyCredentialsDetailed(
  email: string,
  password: string,
  authContext: AuthContext = 'OWNER',
  preferredContaId?: string | null,
): Promise<VerifyCredentialsDetailedResult> {
  const inputEmail = email.trim();

  if (!inputEmail || !password) {
    return { ok: false, reason: 'INVALID_INPUT' };
  }

  try {
    const credential = await prisma.authCredential.findFirst({
      where: { context: authContext, normalizedEmail: inputEmail.toLowerCase() },
      select: { normalizedEmail: true, passwordHash: true, emailVerifiedAt: true, sessionVersion: true, user: { select: { id: true, email: true, nome: true, foto: true, telefone: true, birthDate: true, status: true } } }
    });
    if (!credential) {
      // Equaliza o custo do caminho "usuário inexistente" para reduzir enumeração por timing.
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      return { ok: false, reason: 'USER_NOT_FOUND' };
    }

    const pepper = process.env.BCRYPT_PEPPER || '';
    let ok = await bcrypt.compare(password + pepper, credential.passwordHash);
    if (!ok && process.env.NODE_ENV !== 'production') {
      ok = await bcrypt.compare(password, credential.passwordHash);
    }

    const user = credential.user;
    if (user.status && String(user.status).toUpperCase() !== 'ATIVO') {
      return { ok: false, reason: 'USER_INACTIVE' };
    }
    if (!ok) {
      return { ok: false, reason: 'INVALID_PASSWORD' };
    }

    const access = await resolveUserContaAccess({
      userId: user.id,
      authContext,
      preferredContaId,
    });
    if (!access.ok) {
      return { ok: false, reason: access.reason };
    }

    return {
      ok: true,
      user: {
        id: user.id,
        email: credential.normalizedEmail,
        nome: user.nome,
        foto: user.foto,
        telefone: user.telefone,
        birthDate: user.birthDate,
        role: access.role,
        contaId: preferredContaId ?? (access.accounts.length === 1 ? access.accounts[0].id : undefined),
        emailVerifiedAt: credential.emailVerifiedAt,
        sessionVersion: credential.sessionVersion,
        authContext,
        availableAccounts: access.accounts.map((account) => ({
          id: account.id,
          name: account.name,
          ...('role' in account && account.role ? { role: account.role } : {}),
        })),
      },
    };
  } catch {
    return { ok: false, reason: 'UNEXPECTED_ERROR' };
  }
}

// Legacy helper used by owner registration/dev flows; production login passes an explicit realm.
export async function verifyCredentials(email: string, password: string): Promise<AuthUser | null> {
  const result = await verifyCredentialsDetailed(email, password, 'OWNER');
  return result.ok ? result.user : null;
}
