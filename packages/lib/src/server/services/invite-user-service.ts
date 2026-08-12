import { Prisma, Role } from '@prisma/client';
import { randomUUID } from 'crypto';
import { prisma } from '../../prisma';

export class DuplicateInviteError extends Error { constructor(){ super('Já existe um convite pendente para este e-mail.'); } }
export class UserAlreadyExistsError extends Error { constructor(){ super('Usuário já cadastrado com este e-mail.'); } }
export class UserAlreadyLinkedError extends Error { constructor(){ super('Usuário já vinculado a esta escola.'); } }
export class ForbiddenRoleError extends Error { constructor(){ super('Convites para ADMIN não são permitidos.'); } }
export class InvalidInviteError extends Error { constructor(){ super('Convite inválido.'); } }
export class ExpiredInviteError extends Error { constructor(){ super('Convite expirado.'); } }
export class OwnerRestrictionError extends Error { constructor(){ super('Operação não permitida para Owner.'); } }
export class MissingContaError extends Error { constructor(){ super('Conta do convidador não encontrada.'); } }
export class MissingInviteEmailError extends Error { constructor(){ super('Email é obrigatório para concluir este convite.'); } }

function normalizeEmail(email: string | undefined | null) {
  const normalized = email?.trim().toLowerCase() ?? null;
  return normalized && normalized.length > 0 ? normalized : null;
}

function normalizeAlunoIds(metadata: Prisma.JsonValue | null | undefined) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return [] as string[];
  }

  const rawAlunosIds = (metadata as { alunosIds?: unknown }).alunosIds;
  if (!Array.isArray(rawAlunosIds)) {
    return [] as string[];
  }

  return [...new Set(rawAlunosIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))].sort();
}

function hasSameResponsavelInviteTarget(
  currentMetadata: Prisma.JsonValue | null | undefined,
  nextMetadata: Prisma.InputJsonValue | undefined,
) {
  const currentAlunosIds = normalizeAlunoIds(currentMetadata);
  const nextAlunosIds = normalizeAlunoIds(nextMetadata as Prisma.JsonValue | undefined);

  if (currentAlunosIds.length === 0 || nextAlunosIds.length === 0) {
    return false;
  }

  return JSON.stringify(currentAlunosIds) === JSON.stringify(nextAlunosIds);
}

/**
 * Verifica se o usuário alvo é o Owner da conta.
 * Útil para serviços de usuário que precisam bloquear exclusão/desativação/rebaixamento.
 */
export async function isOwner(userId: string): Promise<boolean> {
  const user = await prisma.usuario.findUnique({ where: { id: userId }, select: { contaId: true, id: true } });
  if (!user?.contaId) return false;
  const conta = await prisma.conta.findUnique({ where: { id: user.contaId }, select: { ownerUserId: true } });
  return !!(conta && conta.ownerUserId === userId);
}

export async function createInvite(
  email: string | undefined | null,
  role: Role,
  invitedById: string,
  contaId?: string,
  metadata?: Prisma.InputJsonValue,
) {
  const normalizedEmail = normalizeEmail(email);
  if (role === Role.ADMIN) throw new ForbiddenRoleError();

  // Descobrir contaId caso não informado
  let targetContaId = contaId || null;
  if (!targetContaId) {
    const inviter = await prisma.usuario.findUnique({ where: { id: invitedById } });
    targetContaId = inviter?.contaId ?? null;
  }
  // Para coerência multi-tenant e do índice único, novas criações DEVEM carregar contaId
  if (!targetContaId) throw new MissingContaError();

  // O e-mail é uma identidade de acesso global e não pode ser reutilizado em outra escola.
  if (normalizedEmail) {
    const existingUser = await prisma.usuario.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
      select: { id: true },
    });

    if (existingUser) throw new UserAlreadyExistsError();
  }

  // Evitar convite duplicado pendente globalmente por (email,status).
  if (normalizedEmail) {
    const dup = await prisma.invite.findFirst({
      where: {
        email: { equals: normalizedEmail, mode: 'insensitive' },
        status: 'PENDING',
      },
    });
    if (dup) throw new DuplicateInviteError();
  } else if (role === Role.RESPONSAVEL && metadata) {
    const pendingResponsavelInvites = await prisma.invite.findMany({
      where: { contaId: targetContaId, role: Role.RESPONSAVEL, status: 'PENDING' },
      select: { id: true, metadata: true },
    });

    const duplicatedInvite = pendingResponsavelInvites.some((invite) =>
      hasSameResponsavelInviteTarget(invite.metadata, metadata),
    );

    if (duplicatedInvite) throw new DuplicateInviteError();
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 72 * 60 * 60 * 1000);
  const token = randomUUID();

  try {
    const created = await prisma.invite.create({
      data: {
        contaId: targetContaId,
        email: normalizedEmail,
        role,
        token,
        invitedById,
        status: 'PENDING',
        expiresAt,
        metadata,
      }
    });
    return created;
  } catch (error) {
    // Protege contra duas criações concorrentes do mesmo convite.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new DuplicateInviteError();
    }
    throw error;
  }
}

export async function acceptInvite(
  token: string,
  nome: string,
  senhaHash: string,
  email?: string | null,
) {
  const invite = await prisma.invite.findUnique({ where: { token } });
  if (!invite || invite.status !== 'PENDING') throw new InvalidInviteError();
  if (invite.expiresAt.getTime() <= Date.now()) throw new ExpiredInviteError();

  // Conta alvo: do convite ou do convidador
  let contaId: string | null = invite.contaId ?? null;
  if (!contaId) {
    const inviter = await prisma.usuario.findUnique({ where: { id: invite.invitedById } });
    contaId = inviter?.contaId ?? null;
  }
  if (!contaId) throw new InvalidInviteError();

  const finalEmail = normalizeEmail(invite.email) ?? normalizeEmail(email);
  if (!finalEmail) throw new MissingInviteEmailError();

  const existingUser = await prisma.usuario.findFirst({
    where: { email: { equals: finalEmail, mode: 'insensitive' } },
    select: {
      id: true,
      contaId: true,
      nome: true,
      email: true,
      telefone: true,
      birthDate: true,
      foto: true,
      bio: true,
      locale: true,
      theme: true,
      notifyEmailProduct: true,
      notifyEmailSecurity: true,
      notifyEmailMarketing: true,
      notifyWhatsapp: true,
      notifySms: true,
      senhaHash: true,
      emailVerifiedAt: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const role = invite.role === 'ADMIN' ? Role.RESPONSAVEL : invite.role as Role;

  return prisma.$transaction(async (tx) => {
    let user = existingUser;

    if (user) {
      // A identidade de acesso é globalmente única. Não compartilhar usuários
      // entre escolas: um e-mail já cadastrado não pode aceitar outro convite.
      throw new UserAlreadyExistsError();
    } else {
      user = await tx.usuario.create({ data: { contaId, nome, email: finalEmail, senhaHash, role } });
    }

    await tx.usuarioConta.create({
      data: {
        usuarioId: user.id,
        contaId,
        role,
        status: 'ATIVO',
        invitedById: invite.invitedById,
        inviteId: invite.id,
        lastAccessedAt: new Date(),
      },
    });

    await tx.invite.update({
      where: { id: invite.id },
      data: { status: 'ACCEPTED', acceptedByUserId: user.id, acceptedAt: new Date() },
    });

    if (role === Role.RESPONSAVEL) {
      await tx.responsavel.updateMany({
        where: { contaId, email: finalEmail },
        data: { usuarioId: user.id },
      });
    }

    return { ...user, contaId, role };
  });
}

export async function listInvitesByConta(contaId: string) {
  return prisma.invite.findMany({ where: { contaId, status: 'PENDING' }, orderBy: { createdAt: 'desc' } });
}

export async function getInviteById(id: string) {
  return prisma.invite.findUnique({ where: { id } });
}

export async function cancelInviteById(id: string): Promise<boolean> {
  const found = await prisma.invite.findUnique({ where: { id } });
  if (!found || String(found.status).toUpperCase() !== 'PENDING') return false;
  await prisma.invite.update({ where: { id }, data: { status: 'REVOKED' } });
  return true;
}
