import { InviteEmailDeliveryStatus, InviteResendRequestStatus, Prisma, Role } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { prisma } from '../../prisma';

export class DuplicateInviteError extends Error {
  constructor() { super('Já existe um convite pendente para este e-mail nesta escola.'); }
}
export class UserInactiveError extends Error {
  constructor() { super('Esta conta de usuário está inativa.'); }
}
export class UserAlreadyLinkedError extends Error {
  constructor() { super('Usuário já vinculado a esta escola.'); }
}
export class ExistingAccountAuthenticationRequiredError extends Error {
  constructor() { super('Entre na conta existente para aceitar este convite.'); }
}
export class InviteStateConflictError extends Error {
  constructor() { super('O convite foi alterado em outra operação. Atualize a página e tente novamente.'); }
}
export class ForbiddenRoleError extends Error {
  constructor() { super('Convites para ADMIN não são permitidos.'); }
}
export class InvalidInviteError extends Error {
  constructor() { super('Convite inválido.'); }
}
export class InvalidInviteTargetError extends Error {
  constructor() { super('Cadastro de convite inválido ou indisponível nesta escola.'); }
}
export class ExpiredInviteError extends Error {
  constructor() { super('Convite expirado.'); }
}
export class MissingContaError extends Error {
  constructor() { super('Conta do convidador não encontrada.'); }
}
export class MissingInviteEmailError extends Error {
  constructor() { super('Email é obrigatório para concluir este convite.'); }
}
export class MissingGuardianRecordError extends Error {
  constructor() { super('Não foi encontrado um cadastro de responsável compatível com este e-mail e os alunos selecionados.'); }
}
export class InvalidGuardianStudentsError extends Error {
  constructor() { super('Um ou mais alunos não pertencem a esta escola.'); }
}
export class StudentAlreadyLinkedError extends Error {
  constructor() { super('Um ou mais alunos já estão vinculados a outro responsável.'); }
}
export class GuardianProfileConflictError extends Error {
  constructor() { super('Os dados informados já pertencem a outro cadastro de responsável nesta escola.'); }
}
export class InviteEmailNotVerifiedError extends Error {
  constructor() { super('Confirme o e-mail antes de aceitar este convite.'); }
}
export class InviteNotFoundError extends Error {
  constructor() { super('Convite não encontrado.'); }
}
export class InviteNotResendableError extends Error {
  readonly status: string;
  constructor(status: string) { super('Este convite não pode ser reenviado neste estado.'); this.status = status; }
}
export class InviteResendRateLimitError extends Error {
  readonly availableAt: Date;
  constructor(availableAt: Date) { super('Aguarde antes de solicitar outro envio deste convite.'); this.availableAt = availableAt; }
}
export class InviteDeliveryInProgressError extends Error {
  constructor() { super('O envio do convite está em andamento. Tente revogar novamente em alguns minutos.'); }
}

const INVITE_RESEND_COOLDOWN_MS = 60_000;
const INVITE_RESEND_PROCESSING_LEASE_MS = 10 * 60_000;

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

function readExistingRecordTarget(metadata: Prisma.JsonValue | Prisma.InputJsonValue | undefined) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const target = (metadata as { target?: unknown }).target;
  if (!target || typeof target !== 'object' || Array.isArray(target)) return null;
  const value = target as { kind?: unknown; recordType?: unknown; recordId?: unknown };
  if (
    value.kind !== 'EXISTING_RECORD' ||
    (value.recordType !== 'COLABORADOR' && value.recordType !== 'RESPONSAVEL') ||
    typeof value.recordId !== 'string' || !value.recordId.trim()
  ) return null;
  return { recordType: value.recordType, recordId: value.recordId.trim() } as const;
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

export async function createInvite(
  email: string | undefined | null,
  role: Role,
  invitedById: string,
  contaId?: string,
  metadata?: Prisma.InputJsonValue,
) {
  const normalizedEmail = normalizeEmail(email);
  if (role === Role.ADMIN) throw new ForbiddenRoleError();

  const targetContaId = contaId?.trim();
  if (!targetContaId) throw new MissingContaError();
  const now = new Date();
  const inviteIdentity = normalizedEmail ?? `${role}:${normalizeAlunoIds(metadata as Prisma.JsonValue | undefined).join(',')}`;
  const lockKey = `invite:${targetContaId}:${inviteIdentity}`;

  try {
    return await prisma.$transaction(async (tx) => {
      // Serialize duplicate checks for the logical invite identity (per tenant).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

      const inviterMembership = await tx.usuarioConta.findFirst({
        where: {
          usuarioId: invitedById,
          contaId: targetContaId,
          status: 'ATIVO',
          usuario: { status: 'ATIVO' },
          conta: { status: 'ATIVO', deletedAt: null },
        },
        select: { id: true },
      });
      if (!inviterMembership) throw new MissingContaError();

      const recordTarget = readExistingRecordTarget(metadata);
      if (recordTarget && ((role === Role.RESPONSAVEL) !== (recordTarget.recordType === 'RESPONSAVEL'))) {
        throw new InvalidInviteTargetError();
      }
      if (recordTarget?.recordType === 'COLABORADOR') {
        const collaborator = await tx.colaborador.findFirst({
          where: { id: recordTarget.recordId, contaId: targetContaId, status: 'ATIVO' },
          select: {
            email: true,
            usuario: { select: { email: true, status: true, acessosConta: { where: { contaId: targetContaId }, select: { status: true } } } },
          },
        });
        if (
          !collaborator?.email || normalizeEmail(collaborator.email) !== normalizedEmail || role === Role.RESPONSAVEL ||
          (collaborator.usuario && normalizeEmail(collaborator.usuario.email) !== normalizedEmail)
        ) {
          throw new InvalidInviteTargetError();
        }
        if (collaborator.usuario && collaborator.usuario.status !== 'ATIVO') throw new UserInactiveError();
        if (collaborator.usuario?.acessosConta.some((membership) => membership.status === 'ATIVO')) throw new UserAlreadyLinkedError();
      }

      let inviteMetadata: Prisma.InputJsonValue | undefined = metadata;

      if (role === Role.RESPONSAVEL) {
        let studentIds = normalizeAlunoIds(metadata as Prisma.JsonValue | undefined);
        if (recordTarget?.recordType === 'RESPONSAVEL') {
          const responsible = await tx.responsavel.findFirst({
            where: { id: recordTarget.recordId, contaId: targetContaId },
            select: {
              usuario: { select: { status: true, acessosConta: { where: { contaId: targetContaId }, select: { status: true } } } },
              alunos: { where: { contaId: targetContaId }, select: { alunoId: true, aluno: { select: { contaId: true } } }, orderBy: { alunoId: 'asc' } },
            },
          });
          if (!responsible) throw new InvalidInviteTargetError();
          if (responsible.usuario && responsible.usuario.status !== 'ATIVO') throw new UserInactiveError();
          if (responsible.usuario?.acessosConta.some((membership) => membership.status === 'ATIVO')) throw new UserAlreadyLinkedError();
          studentIds = [...new Set(responsible.alunos
            .filter((link) => link.aluno.contaId === targetContaId)
            .map(({ alunoId }) => alunoId))].sort();
          if (!studentIds.length) throw new InvalidInviteTargetError();
          inviteMetadata = {
            target: { kind: 'EXISTING_RECORD', recordType: 'RESPONSAVEL', recordId: recordTarget.recordId },
            alunosIds: studentIds,
          };
        }
        if (!studentIds.length) throw new InvalidInviteError();
        const linkedStudents = await tx.alunoResponsavel.findMany({
          where: {
            contaId: targetContaId,
            alunoId: { in: studentIds },
            ...(recordTarget?.recordType === 'RESPONSAVEL' ? { responsavelId: { not: recordTarget.recordId } } : {}),
          },
          select: { alunoId: true },
          distinct: ['alunoId'],
        });
        if (linkedStudents.length > 0) throw new StudentAlreadyLinkedError();
      } else if (recordTarget) {
        inviteMetadata = {
          target: { kind: 'EXISTING_RECORD', recordType: 'COLABORADOR', recordId: recordTarget.recordId },
        };
      }

      // Expiração é terminal; limpar o estado antes de checar/reemitir dentro do tenant.
      await tx.invite.updateMany({
        where: { contaId: targetContaId, status: 'PENDING', expiresAt: { lte: now } },
        data: { status: 'EXPIRED' },
      });

      // Um usuário global pode receber acesso a várias escolas, mas não duas vezes à mesma.
      if (normalizedEmail) {
        const existingUser = await tx.usuario.findFirst({
          where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
          select: { id: true },
        });
        if (existingUser) {
          const membership = await tx.usuarioConta.findUnique({
            where: { usuarioId_contaId: { usuarioId: existingUser.id, contaId: targetContaId } },
            select: { id: true, status: true },
          });
          if (membership?.status === 'ATIVO') throw new UserAlreadyLinkedError();
        }

        const duplicate = await tx.invite.findFirst({
          where: {
            contaId: targetContaId,
            email: { equals: normalizedEmail, mode: 'insensitive' },
            status: 'PENDING',
            expiresAt: { gt: now },
          },
        });
        if (duplicate) throw new DuplicateInviteError();
      } else if (role === Role.RESPONSAVEL && metadata) {
        const pendingResponsavelInvites = await tx.invite.findMany({
          where: { contaId: targetContaId, role: Role.RESPONSAVEL, status: 'PENDING' },
          select: { id: true, metadata: true },
        });

        const duplicatedInvite = pendingResponsavelInvites.some((invite) =>
          hasSameResponsavelInviteTarget(invite.metadata, metadata),
        );

        if (duplicatedInvite) throw new DuplicateInviteError();
      }

      const expiresAt = new Date(now.getTime() + 72 * 60 * 60 * 1000);
      const token = randomUUID();
      return tx.invite.create({
        data: {
          contaId: targetContaId,
          email: normalizedEmail,
          role,
          token,
          invitedById,
          status: 'PENDING',
          expiresAt,
          metadata: inviteMetadata,
          emailDeliveryStatus: normalizedEmail ? InviteEmailDeliveryStatus.PENDING : InviteEmailDeliveryStatus.NOT_APPLICABLE,
        },
      });
    });
  } catch (error) {
    // Protege contra duas criações concorrentes do mesmo convite.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new DuplicateInviteError();
    }
    throw error;
  }
}

async function loadAcceptableInvite(tx: Prisma.TransactionClient, token: string, now: Date) {
  const invite = await tx.invite.findUnique({ where: { token } });
  if (!invite || invite.status !== 'PENDING') throw new InvalidInviteError();
  if (invite.expiresAt <= now) throw new ExpiredInviteError();
  const contaId = invite.contaId;
  if (!contaId || invite.role === Role.ADMIN) throw new InvalidInviteError();
  const conta = await tx.conta.findFirst({ where: { id: contaId, status: 'ATIVO', deletedAt: null }, select: { id: true } });
  if (!conta) throw new InvalidInviteError();
  const inviterMembership = await tx.usuarioConta.findFirst({
    where: { usuarioId: invite.invitedById, contaId, status: 'ATIVO', usuario: { status: 'ATIVO' } },
    select: { id: true },
  });
  if (!inviterMembership) throw new InvalidInviteError();
  return invite;
}

/**
 * Creates only the global identity needed to receive email verification.
 * This deliberately does not create tenant access or link operational records.
 */
export async function prepareInviteIdentity(token: string, nome: string, senhaHash: string, email: string) {
  const acceptedEmail = normalizeEmail(email);
  if (!acceptedEmail) throw new MissingInviteEmailError();
  const now = new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`invite-identity:${acceptedEmail}`}, 0))`;
      const invite = await loadAcceptableInvite(tx, token, now);
      const invitedEmail = normalizeEmail(invite.email);
      if (invitedEmail && invitedEmail !== acceptedEmail) throw new InvalidInviteError();
      const existing = await tx.usuario.findFirst({
        where: { email: { equals: acceptedEmail, mode: 'insensitive' } },
        select: { id: true, email: true, nome: true, role: true, contaId: true, status: true, emailVerifiedAt: true },
      });
      if (existing) return existing;
      return await tx.usuario.create({
        data: { contaId: null, nome: nome.trim(), email: acceptedEmail, senhaHash, role: invite.role, status: 'ATIVO' },
        select: { id: true, email: true, nome: true, role: true, contaId: true, status: true, emailVerifiedAt: true },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2002', 'P2034'].includes(error.code)) {
      throw error;
    }

    // Two first submissions can take their serializable snapshots before the
    // advisory-lock winner commits. Recover only the same verified target
    // identity; never overwrite its name, password, status, or tenant links.
    const existing = await prisma.$transaction(async (tx) => {
      const invite = await loadAcceptableInvite(tx, token, new Date());
      const invitedEmail = normalizeEmail(invite.email);
      if (invitedEmail && invitedEmail !== acceptedEmail) throw new InvalidInviteError();
      return tx.usuario.findFirst({
        where: { email: { equals: acceptedEmail, mode: 'insensitive' } },
        select: { id: true, email: true, nome: true, role: true, contaId: true, status: true, emailVerifiedAt: true },
      });
    });
    if (existing) return existing;
    if (error.code === 'P2002') throw new ExistingAccountAuthenticationRequiredError();
    throw new InviteStateConflictError();
  }
}

export async function acceptInvite(
  token: string,
  email: string,
  authenticatedUserId: string,
) {
  const finalEmail = normalizeEmail(email);
  const now = new Date();

  try {
    return await prisma.$transaction(async (tx) => {
      const completedInvite = await tx.invite.findUnique({ where: { token } });
      if (completedInvite?.status === 'ACCEPTED') {
        if (completedInvite.acceptedByUserId !== authenticatedUserId || !completedInvite.contaId) throw new InvalidInviteError();
        const completedUser = await tx.usuario.findFirst({
          where: { id: authenticatedUserId, email: { equals: finalEmail ?? '', mode: 'insensitive' }, status: 'ATIVO', emailVerifiedAt: { not: null } },
        });
        const completedMembership = await tx.usuarioConta.findUnique({
          where: { usuarioId_contaId: { usuarioId: authenticatedUserId, contaId: completedInvite.contaId } },
        });
        if (!completedUser || completedMembership?.status !== 'ATIVO' || completedMembership.inviteId !== completedInvite.id) throw new InvalidInviteError();
        return { ...completedUser, contaId: completedInvite.contaId, role: completedMembership.role };
      }
      const invite = await loadAcceptableInvite(tx, token, now);
      if (!invite.contaId) throw new InvalidInviteError();
      const contaId = invite.contaId;
      const invitedEmail = normalizeEmail(invite.email);
      if (invitedEmail && finalEmail !== invitedEmail) throw new InvalidInviteError();
      const acceptedEmail = invitedEmail ?? finalEmail;
      if (!acceptedEmail) throw new MissingInviteEmailError();
      const role = invite.role;
      const user = await tx.usuario.findFirst({
        where: { id: authenticatedUserId, email: { equals: acceptedEmail, mode: 'insensitive' } },
      });
      if (!user) throw new InvalidInviteError();
      if (user && String(user.status).toUpperCase() !== 'ATIVO') throw new UserInactiveError();
      if (!user.emailVerifiedAt) throw new InviteEmailNotVerifiedError();

      const existingMembership = await tx.usuarioConta.findUnique({
        where: { usuarioId_contaId: { usuarioId: user.id, contaId } },
      });
      if (existingMembership?.status === 'ATIVO') throw new UserAlreadyLinkedError();
      let collaboratorIdToLink: string | null = null;
      let guardianIdToLink: string | null = null;

      if (role === Role.RESPONSAVEL) {
        const studentIds = normalizeAlunoIds(invite.metadata);
        if (!studentIds.length) throw new InvalidInviteError();
        const target = readExistingRecordTarget(invite.metadata as Prisma.JsonValue | undefined);
        if (target?.recordType !== 'RESPONSAVEL') throw new InvalidInviteTargetError();
        const guardian = await tx.responsavel.findFirst({
          where: { id: target.recordId, contaId },
          select: { id: true, usuarioId: true },
        });
        if (!guardian) throw new InvalidInviteTargetError();
        const students = await tx.aluno.findMany({ where: { contaId, id: { in: studentIds } }, select: { id: true } });
        if (students.length !== studentIds.length) throw new InvalidGuardianStudentsError();
        if (guardian.usuarioId && guardian.usuarioId !== user.id) throw new GuardianProfileConflictError();
        const linkedRows = await tx.alunoResponsavel.findMany({
          where: { contaId, responsavelId: guardian.id },
          select: { alunoId: true, aluno: { select: { contaId: true } } },
        });
        const scopedLinkedStudents = [...new Set(linkedRows.filter((link) => link.aluno.contaId === contaId).map((link) => link.alunoId))].sort();
        if (JSON.stringify(scopedLinkedStudents) !== JSON.stringify(studentIds)) throw new InvalidGuardianStudentsError();
        guardianIdToLink = guardian.id;
      } else {
        const target = readExistingRecordTarget(invite.metadata as Prisma.JsonValue | undefined);
        if (target && target.recordType !== 'COLABORADOR') throw new InvalidInviteTargetError();
        if (target) {
          const collaborator = await tx.colaborador.findFirst({
            where: { id: target.recordId, contaId },
            select: { usuarioId: true, email: true, status: true },
          });
          if (!collaborator || !collaborator.email || normalizeEmail(collaborator.email) !== acceptedEmail) throw new InvalidInviteTargetError();
          if (collaborator.usuarioId && collaborator.usuarioId !== user.id) throw new InvalidInviteTargetError();
          if (collaborator.status !== 'ATIVO') throw new InvalidInviteTargetError();
          collaboratorIdToLink = target.recordId;
        }
      }

      if (existingMembership) {
        await tx.usuarioConta.update({
          where: { id: existingMembership.id },
          data: { role, status: 'ATIVO', invitedById: invite.invitedById, inviteId: invite.id, lastAccessedAt: now },
        });
      } else {
        await tx.usuarioConta.create({
          data: { usuarioId: user.id, contaId, role, status: 'ATIVO', invitedById: invite.invitedById, inviteId: invite.id, lastAccessedAt: now },
        });
      }

      // Membership must exist first because Colaborador uses a composite FK to it.
      if (collaboratorIdToLink) {
        await tx.colaborador.update({ where: { id: collaboratorIdToLink }, data: { usuarioId: user.id, temAcesso: true } });
      }
      if (guardianIdToLink) {
        await tx.responsavel.update({ where: { id: guardianIdToLink }, data: { usuarioId: user.id } });
      }

      const claimed = await tx.invite.updateMany({
        where: { id: invite.id, status: 'PENDING', expiresAt: { gt: now } },
        data: { status: 'ACCEPTED', acceptedByUserId: user.id, acceptedAt: now },
      });
      if (claimed.count !== 1) throw new InvalidInviteError();
      return { ...user, contaId, role };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof ExpiredInviteError) {
      await prisma.invite.updateMany({ where: { token, status: 'PENDING', expiresAt: { lte: now } }, data: { status: 'EXPIRED' } });
      throw error;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2002' || error.code === 'P2034')) {
      const invite = await prisma.invite.findUnique({
        where: { token },
        select: { id: true, contaId: true, email: true, status: true, acceptedByUserId: true },
      });
      if (
        invite?.status === 'ACCEPTED' &&
        invite.acceptedByUserId === authenticatedUserId &&
        invite.contaId
      ) {
        const completedUser = await prisma.usuario.findFirst({
          where: {
            id: authenticatedUserId,
            email: { equals: finalEmail ?? '', mode: 'insensitive' },
            status: 'ATIVO',
            emailVerifiedAt: { not: null },
          },
        });
        const completedMembership = await prisma.usuarioConta.findUnique({
          where: { usuarioId_contaId: { usuarioId: authenticatedUserId, contaId: invite.contaId } },
        });
        if (
          !completedUser ||
          completedMembership?.status !== 'ATIVO' ||
          completedMembership.inviteId !== invite.id
        ) {
          throw new InvalidInviteError();
        }
        return { ...completedUser, contaId: invite.contaId, role: completedMembership.role };
      }
      if (invite?.status !== 'PENDING') throw new InvalidInviteError();
      if (error.code === 'P2034') throw new InviteStateConflictError();
      throw new DuplicateInviteError();
    }
    throw error;
  }
}

export async function expirePendingInvite(token: string) {
  await prisma.invite.updateMany({
    where: { token, status: 'PENDING', expiresAt: { lte: new Date() } },
    data: { status: 'EXPIRED' },
  });
}

export async function recordInviteEmailDelivery(input: {
  inviteId: string;
  contaId: string;
  delivery: 'SENT' | 'LOGGED' | 'FAILED';
}) {
  const now = new Date();
  return prisma.invite.updateMany({
    where: { id: input.inviteId, contaId: input.contaId, status: 'PENDING' },
    data: {
      emailDeliveryStatus: input.delivery,
      deliveryAttempts: { increment: 1 },
      lastDeliveryAttemptAt: now,
      lastDeliveryErrorCode: input.delivery === 'FAILED' ? 'DELIVERY_FAILED' : null,
    },
  });
}

export async function revokeInviteById(id: string, contaId: string, actorUserId: string) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const lockKey = `invite-resend:${contaId}:${id}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
    const invite = await tx.invite.findFirst({
      where: { id, contaId },
      select: { id: true, status: true, expiresAt: true },
    });
    if (!invite) return 'NOT_FOUND' as const;
    if (invite.status === 'REVOKED') return 'REVOKED' as const;
    if (invite.status !== 'PENDING') return invite.status === 'EXPIRED' ? 'EXPIRED' as const : 'NOT_REVOCABLE' as const;
    const activeDelivery = await tx.inviteResendRequest.findFirst({
      where: {
        inviteId: id,
        contaId,
        status: InviteResendRequestStatus.PROCESSING,
        leaseExpiresAt: { gt: now },
      },
      select: { id: true },
    });
    if (activeDelivery) return 'DELIVERY_IN_PROGRESS' as const;
    const timedOutDeliveries = await tx.inviteResendRequest.updateMany({
      where: {
        inviteId: id,
        contaId,
        status: InviteResendRequestStatus.PROCESSING,
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
      },
      data: {
        status: InviteResendRequestStatus.FAILED,
        deliveryErrorCode: 'DELIVERY_TIMEOUT',
        leaseExpiresAt: null,
        completedAt: now,
      },
    });
    if (timedOutDeliveries.count > 0) {
      await tx.invite.updateMany({
        where: { id, contaId, status: 'PENDING' },
        data: { emailDeliveryStatus: InviteEmailDeliveryStatus.FAILED, lastDeliveryAttemptAt: now, lastDeliveryErrorCode: 'DELIVERY_TIMEOUT' },
      });
    }
    if (invite.expiresAt <= now) {
      await tx.invite.updateMany({ where: { id, contaId, status: 'PENDING', expiresAt: { lte: now } }, data: { status: 'EXPIRED' } });
      return 'EXPIRED' as const;
    }

    const changed = await tx.invite.updateMany({
      where: { id, contaId, status: 'PENDING', expiresAt: { gt: now } },
      data: { status: 'REVOKED', revokedAt: now },
    });
    if (changed.count !== 1) return 'NOT_REVOCABLE' as const;
    await tx.auditLog.create({
      data: {
        contaId,
        actorType: 'USER',
        actorId: actorUserId,
        action: 'USER_INVITE_REVOKED',
        entityType: 'Invite',
        entityId: id,
        metadata: { previousStatus: 'PENDING', nextStatus: 'REVOKED' },
      },
    });
    return 'REVOKED' as const;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export type InviteResendReservation =
  | { kind: 'RESERVED'; attemptId: string; inviteId: string; contaId: string; token: string; email: string; role: Role; expiresAt: Date; leaseExpiresAt: Date; invitedByName: string | null }
  | { kind: 'REPLAY'; attemptStatus: InviteResendRequestStatus; inviteId: string; contaId: string; token: string; email: string | null; role: Role; expiresAt: Date }
  | { kind: 'MANUAL'; attemptId: string; inviteId: string; contaId: string; token: string; email: null; role: Role; expiresAt: Date }
  | { kind: 'MANUAL_REPLAY'; attemptId: string; inviteId: string; contaId: string; token: string; email: null; role: Role; expiresAt: Date };

export async function reserveInviteResend(input: {
  id: string;
  contaId: string;
  actorUserId: string;
  idempotencyKey: string;
}): Promise<InviteResendReservation> {
  const normalizedKey = input.idempotencyKey.trim();
  const fingerprint = createHash('sha256').update(normalizedKey).digest('hex');
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const lockKey = `invite-resend:${input.contaId}:${input.id}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
    const invite = await tx.invite.findFirst({
      where: { id: input.id, contaId: input.contaId },
      select: {
        id: true, contaId: true, status: true, expiresAt: true, token: true, email: true, role: true,
        resendAvailableAt: true,
        invitedById: true,
      },
    });
    if (!invite) throw new InviteNotFoundError();
    const inviter = await tx.usuario.findUnique({ where: { id: invite.invitedById }, select: { nome: true } });
    if (invite.status !== 'PENDING') throw new InviteNotResendableError(invite.status);
    if (invite.expiresAt <= now) return { kind: 'EXPIRED' as const };

    const compoundKey = { uq_invite_resend_request_key: { inviteId: invite.id, requestKeyFingerprint: fingerprint } };
    const existingAttempt = await tx.inviteResendRequest.findUnique({
      where: compoundKey,
      select: { id: true, status: true, leaseExpiresAt: true },
    });
    if (existingAttempt) {
      const staleProcessing = existingAttempt.status === InviteResendRequestStatus.PROCESSING &&
        (!existingAttempt.leaseExpiresAt || existingAttempt.leaseExpiresAt <= now);
      if (staleProcessing) {
        const reclaimed = await tx.inviteResendRequest.updateMany({
          where: {
            id: existingAttempt.id,
            inviteId: invite.id,
            contaId: input.contaId,
            status: InviteResendRequestStatus.PROCESSING,
            OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
          },
          data: { leaseExpiresAt: new Date(now.getTime() + INVITE_RESEND_PROCESSING_LEASE_MS) },
        });
        if (reclaimed.count === 1 && invite.email) {
          const leaseExpiresAt = new Date(now.getTime() + INVITE_RESEND_PROCESSING_LEASE_MS);
          await tx.invite.update({
            where: { id: invite.id },
            data: {
              emailDeliveryStatus: InviteEmailDeliveryStatus.PENDING,
              deliveryAttempts: { increment: 1 },
              lastDeliveryAttemptAt: now,
              lastDeliveryErrorCode: null,
              resendAvailableAt: new Date(now.getTime() + INVITE_RESEND_COOLDOWN_MS),
            },
          });
          return {
            kind: 'RESERVED' as const, attemptId: existingAttempt.id, ...invite,
            inviteId: invite.id, contaId: input.contaId, email: invite.email,
            leaseExpiresAt, invitedByName: inviter?.nome ?? null,
          };
        }
      }
      if (!invite.email) {
        return { kind: 'MANUAL_REPLAY' as const, attemptId: existingAttempt.id, ...invite, inviteId: invite.id, contaId: input.contaId, email: null };
      }
      return { kind: 'REPLAY' as const, attemptStatus: existingAttempt.status, ...invite, inviteId: invite.id, contaId: input.contaId };
    }
    const expiredAttempts = await tx.inviteResendRequest.updateMany({
      where: {
        inviteId: invite.id,
        contaId: input.contaId,
        status: InviteResendRequestStatus.PROCESSING,
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
      },
      data: {
        status: InviteResendRequestStatus.FAILED,
        deliveryErrorCode: 'DELIVERY_TIMEOUT',
        leaseExpiresAt: null,
        completedAt: now,
      },
    });
    if (expiredAttempts.count > 0) {
      await tx.invite.update({
        where: { id: invite.id },
        data: { emailDeliveryStatus: InviteEmailDeliveryStatus.FAILED, lastDeliveryAttemptAt: now, lastDeliveryErrorCode: 'DELIVERY_TIMEOUT' },
      });
    }
    const activeAttempt = await tx.inviteResendRequest.findFirst({
      where: { inviteId: invite.id, contaId: input.contaId, status: InviteResendRequestStatus.PROCESSING, leaseExpiresAt: { gt: now } },
      select: { leaseExpiresAt: true },
    });
    if (activeAttempt?.leaseExpiresAt) throw new InviteResendRateLimitError(activeAttempt.leaseExpiresAt);
    if (invite.resendAvailableAt && invite.resendAvailableAt > now) {
      throw new InviteResendRateLimitError(invite.resendAvailableAt);
    }

    const manual = !invite.email;
    const attempt = await tx.inviteResendRequest.create({
      data: {
        inviteId: invite.id,
        contaId: input.contaId,
        requestKeyFingerprint: fingerprint,
        status: manual ? InviteResendRequestStatus.NOT_APPLICABLE : InviteResendRequestStatus.PROCESSING,
        leaseExpiresAt: manual ? null : new Date(now.getTime() + INVITE_RESEND_PROCESSING_LEASE_MS),
        completedAt: manual ? now : null,
      },
      select: { id: true },
    });
    await tx.invite.update({
      where: { id: invite.id },
      data: {
        ...(manual ? { emailDeliveryStatus: InviteEmailDeliveryStatus.NOT_APPLICABLE } : {
          emailDeliveryStatus: InviteEmailDeliveryStatus.PENDING,
          deliveryAttempts: { increment: 1 },
          lastDeliveryAttemptAt: now,
          lastDeliveryErrorCode: null,
        }),
        resendAvailableAt: new Date(now.getTime() + INVITE_RESEND_COOLDOWN_MS),
      },
    });
    await tx.auditLog.create({
      data: {
        contaId: input.contaId,
        actorType: 'USER',
        actorId: input.actorUserId,
        action: 'USER_INVITE_RESEND_REQUESTED',
        entityType: 'Invite',
        entityId: invite.id,
        correlationId: attempt.id,
        metadata: { deliveryMode: manual ? 'MANUAL' : 'EMAIL' },
      },
    });
    if (manual) return { kind: 'MANUAL' as const, attemptId: attempt.id, ...invite, inviteId: invite.id, contaId: input.contaId, email: null };
    return {
      kind: 'RESERVED' as const, attemptId: attempt.id, ...invite, inviteId: invite.id,
      contaId: input.contaId, email: invite.email!,
      leaseExpiresAt: new Date(now.getTime() + INVITE_RESEND_PROCESSING_LEASE_MS),
      invitedByName: inviter?.nome ?? null,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

  if (result.kind === 'EXPIRED') {
    await prisma.invite.updateMany({
      where: { id: input.id, contaId: input.contaId, status: 'PENDING', expiresAt: { lte: now } },
      data: { status: 'EXPIRED' },
    });
    throw new ExpiredInviteError();
  }
  return result;
}

export async function completeInviteResend(input: {
  inviteId: string;
  contaId: string;
  attemptId: string;
  leaseExpiresAt: Date;
  delivery: 'SENT' | 'LOGGED' | 'FAILED';
}) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const attemptStatus = input.delivery as InviteResendRequestStatus;
    const attempt = await tx.inviteResendRequest.updateMany({
      where: { id: input.attemptId, inviteId: input.inviteId, contaId: input.contaId, status: 'PROCESSING', leaseExpiresAt: input.leaseExpiresAt },
      data: { status: attemptStatus, deliveryErrorCode: input.delivery === 'FAILED' ? 'DELIVERY_FAILED' : null, leaseExpiresAt: null, completedAt: now },
    });
    if (attempt.count !== 1) return false;
    await tx.invite.updateMany({
      where: { id: input.inviteId, contaId: input.contaId, status: 'PENDING' },
      data: {
        emailDeliveryStatus: input.delivery,
        lastDeliveryAttemptAt: now,
        lastDeliveryErrorCode: input.delivery === 'FAILED' ? 'DELIVERY_FAILED' : null,
      },
    });
    return true;
  });
}

export async function listInvitesByConta(contaId: string) {
  const now = new Date();
  await prisma.invite.updateMany({ where: { contaId, status: 'PENDING', expiresAt: { lte: now } }, data: { status: 'EXPIRED' } });
  return prisma.invite.findMany({
    where: { contaId, status: { in: ['PENDING', 'EXPIRED', 'ACCEPTED', 'REVOKED'] } },
    select: {
      id: true, email: true, role: true, status: true, createdAt: true, expiresAt: true,
      emailDeliveryStatus: true, deliveryAttempts: true, lastDeliveryErrorCode: true, lastDeliveryAttemptAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}
