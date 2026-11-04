import { Prisma, Role } from '@prisma/client';
import { randomUUID } from 'crypto';
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
export class MissingGuardianDataError extends Error {
  constructor() { super('Informe CPF e telefone para concluir o cadastro de responsável.'); }
}

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

export async function acceptInvite(
  token: string,
  nome: string,
  senhaHash: string,
  email?: string | null,
  authenticatedUserId?: string,
  guardianProfile?: { cpf: string; telefone: string } | null,
) {
  const finalEmail = normalizeEmail(email);
  const now = new Date();

  try {
    return await prisma.$transaction(async (tx) => {
      const invite = await tx.invite.findUnique({ where: { token } });
      if (!invite || invite.status !== 'PENDING') throw new InvalidInviteError();
      if (invite.expiresAt <= now) throw new ExpiredInviteError();

      const contaId = invite.contaId;
      if (!contaId) throw new InvalidInviteError();
      const conta = await tx.conta.findFirst({
        where: { id: contaId, status: 'ATIVO', deletedAt: null },
        select: { id: true },
      });
      if (!conta) throw new InvalidInviteError();
      const inviterMembership = await tx.usuarioConta.findFirst({
        where: {
          usuarioId: invite.invitedById,
          contaId,
          status: 'ATIVO',
          usuario: { status: 'ATIVO' },
        },
        select: { id: true },
      });
      if (!inviterMembership) throw new InvalidInviteError();
      const invitedEmail = normalizeEmail(invite.email);
      if (invitedEmail && finalEmail !== invitedEmail) throw new InvalidInviteError();
      const acceptedEmail = invitedEmail ?? finalEmail;
      if (!acceptedEmail) throw new MissingInviteEmailError();
      if (invite.role === Role.ADMIN) throw new InvalidInviteError();
      const role = invite.role;

      let user = authenticatedUserId
        ? await tx.usuario.findFirst({ where: { id: authenticatedUserId, email: { equals: acceptedEmail, mode: 'insensitive' } } })
        : await tx.usuario.findFirst({ where: { email: { equals: acceptedEmail, mode: 'insensitive' } } });
      if (authenticatedUserId && !user) throw new InvalidInviteError();
      if (user && String(user.status).toUpperCase() !== 'ATIVO') throw new UserInactiveError();
      if (user && !authenticatedUserId) throw new ExistingAccountAuthenticationRequiredError();
      if (!user) {
        user = await tx.usuario.create({
          data: {
            contaId,
            nome,
            email: acceptedEmail,
            senhaHash,
            role,
            ...(guardianProfile?.telefone ? { telefone: guardianProfile.telefone } : {}),
          },
        });
      }

      const existingMembership = await tx.usuarioConta.findUnique({
        where: { usuarioId_contaId: { usuarioId: user.id, contaId } },
      });
      if (existingMembership?.status === 'ATIVO') throw new UserAlreadyLinkedError();

      if (role === Role.RESPONSAVEL) {
        if (!guardianProfile?.cpf || !guardianProfile.telefone) throw new MissingGuardianDataError();
        const studentIds = normalizeAlunoIds(invite.metadata);
        if (!studentIds.length) throw new InvalidInviteError();
        const students = await tx.aluno.findMany({ where: { contaId, id: { in: studentIds } }, select: { id: true } });
        if (students.length !== studentIds.length) throw new InvalidGuardianStudentsError();
        const matchingGuardians = await tx.responsavel.findMany({
          where: {
            contaId,
            OR: [
              { cpf: guardianProfile.cpf },
              { usuarioId: user.id },
              { email: { equals: acceptedEmail, mode: 'insensitive' } },
            ],
          },
          select: { id: true, usuarioId: true, cpf: true, email: true },
        });
        const matchingGuardianIds = new Set(matchingGuardians.map(({ id }) => id));
        if (
          matchingGuardianIds.size > 1 ||
          matchingGuardians.some(({ usuarioId, cpf, email: guardianEmail }) =>
            (usuarioId && usuarioId !== user.id) ||
            (cpf !== guardianProfile.cpf && (usuarioId === user.id || guardianEmail.toLowerCase() === acceptedEmail)),
          )
        ) {
          throw new GuardianProfileConflictError();
        }
        const guardian = matchingGuardians[0] ?? null;
        if (!guardian) {
          await tx.responsavel.create({
            data: {
              contaId,
              nome: nome.trim(),
              cpf: guardianProfile.cpf,
              email: acceptedEmail,
              telefone: guardianProfile.telefone,
              usuarioId: user.id,
            },
          });
        } else {
          await tx.responsavel.update({ where: { id: guardian.id }, data: { usuarioId: user.id } });
        }
        const guardianId = guardian?.id ?? (await tx.responsavel.findFirstOrThrow({
          where: { contaId, cpf: guardianProfile.cpf }, select: { id: true },
        })).id;
        const existingLinks = await tx.alunoResponsavel.findMany({
          where: { contaId, alunoId: { in: studentIds }, responsavelId: { not: guardianId } },
          select: { alunoId: true },
          distinct: ['alunoId'],
        });
        if (existingLinks.length > 0) throw new StudentAlreadyLinkedError();
        for (const alunoId of studentIds) {
          await tx.alunoResponsavel.upsert({
            where: { uq_aluno_responsavel_conta_aluno_responsavel: { contaId, alunoId, responsavelId: guardianId } },
            create: { contaId, alunoId, responsavelId: guardianId, tipoVinculo: 'RESPONSAVEL' },
            update: {},
          });
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
      const invite = await prisma.invite.findUnique({ where: { token }, select: { id: true, contaId: true, email: true, status: true } });
      if (invite?.status !== 'PENDING') throw new InvalidInviteError();
      const existingUser = await prisma.usuario.findFirst({ where: { email: { equals: finalEmail ?? invite.email ?? '', mode: 'insensitive' } }, select: { id: true } });
      if (existingUser && invite.contaId) {
        const membership = await prisma.usuarioConta.findUnique({ where: { usuarioId_contaId: { usuarioId: existingUser.id, contaId: invite.contaId } }, select: { status: true } });
        if (membership) throw new UserAlreadyLinkedError();
        throw new ExistingAccountAuthenticationRequiredError();
      }
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

export async function listInvitesByConta(contaId: string) {
  const now = new Date();
  await prisma.invite.updateMany({ where: { contaId, status: 'PENDING', expiresAt: { lte: now } }, data: { status: 'EXPIRED' } });
  return prisma.invite.findMany({
    where: { contaId, status: { in: ['PENDING', 'EXPIRED', 'ACCEPTED', 'REVOKED'] } },
    select: { id: true, email: true, role: true, status: true, createdAt: true, expiresAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function deleteInviteById(id: string, contaId: string): Promise<boolean> {
  const result = await prisma.invite.deleteMany({
    where: { id, contaId },
  });
  return result.count === 1;
}
