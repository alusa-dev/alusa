import prisma from '@/lib/prisma';
import type { InviteRecordTypeDTO } from '@/features/users/dtos';

export async function findStudentsInContaForInvite(contaId: string, studentIds: string[]) {
  return prisma.aluno.findMany({
    where: { contaId, id: { in: studentIds } },
    select: { id: true },
  });
}

export type InviteRecordTarget = {
  recordType: InviteRecordTypeDTO;
  recordId: string;
  name: string;
  email: string | null;
  alunosIds: string[];
  accessStatus: 'ACTIVE' | 'SUSPENDED' | 'NONE';
  canInvite: boolean;
};

type AccessStatus = 'ACTIVE' | 'SUSPENDED' | 'NONE';
type PendingInviteTargets = { emails: Set<string>; recordIds: Set<string> };

function accessState(input: { userStatus?: string | null; membershipStatus?: string | null }): AccessStatus {
  if (input.membershipStatus === 'ATIVO' && input.userStatus === 'ATIVO') return 'ACTIVE';
  if (input.userStatus === 'INATIVO' || input.membershipStatus) return 'SUSPENDED';
  return 'NONE';
}

function canInvite(input: { accessStatus: AccessStatus; userStatus?: string | null; invitePending: boolean }) {
  return input.accessStatus !== 'ACTIVE' && input.userStatus !== 'INATIVO' && !input.invitePending;
}

export async function findInviteTargetInConta(
  contaId: string,
  input: { recordType: InviteRecordTypeDTO; recordId: string },
): Promise<InviteRecordTarget | null> {
  if (input.recordType === 'COLABORADOR') {
    const record = await prisma.colaborador.findFirst({
      where: { id: input.recordId, contaId, status: 'ATIVO', email: { not: null } },
      select: {
        id: true,
        nome: true,
        email: true,
        usuario: { select: { status: true, acessosConta: { where: { contaId }, select: { status: true } } } },
      },
    });
    if (!record?.email?.trim()) return null;
    const accessStatus = accessState({ userStatus: record.usuario?.status, membershipStatus: record.usuario?.acessosConta[0]?.status });
    return {
      recordType: input.recordType,
      recordId: record.id,
      name: record.nome,
      email: record.email.trim().toLowerCase(),
      alunosIds: [],
      accessStatus,
      canInvite: canInvite({ accessStatus, userStatus: record.usuario?.status, invitePending: false }),
    };
  }

  const record = await prisma.responsavel.findFirst({
    where: { id: input.recordId, contaId, alunos: { some: { contaId } } },
    select: {
      id: true,
      nome: true,
      email: true,
      usuario: { select: { status: true, acessosConta: { where: { contaId }, select: { status: true } } } },
      alunos: { where: { contaId }, select: { alunoId: true, aluno: { select: { contaId: true } } }, orderBy: { alunoId: 'asc' } },
    },
  });
  const scopedLinks = record?.alunos.filter((link) => link.aluno.contaId === contaId) ?? [];
  if (!record || scopedLinks.length === 0) return null;
  const accessStatus = accessState({ userStatus: record.usuario?.status, membershipStatus: record.usuario?.acessosConta[0]?.status });
  return {
    recordType: input.recordType,
    recordId: record.id,
    name: record.nome,
    email: record.email.trim() ? record.email.trim().toLowerCase() : null,
    alunosIds: scopedLinks.map((link) => link.alunoId),
    accessStatus,
    canInvite: canInvite({ accessStatus, userStatus: record.usuario?.status, invitePending: false }),
  };
}

export async function findInviteCandidatesInConta(input: {
  contaId: string;
  recordType: InviteRecordTypeDTO;
  query?: string;
  page: number;
  limit: number;
}) {
  const skip = (input.page - 1) * input.limit;
  const search = input.query?.trim();
  const nameFilter = search ? { contains: search, mode: 'insensitive' as const } : undefined;
  const whereSearch = search ? { OR: [{ nome: nameFilter }, { email: { contains: search, mode: 'insensitive' as const } }] } : {};

  if (input.recordType === 'COLABORADOR') {
    const rows = await prisma.colaborador.findMany({
      where: { contaId: input.contaId, status: 'ATIVO', ...whereSearch },
      select: {
        id: true, nome: true, email: true,
        usuario: { select: { status: true, acessosConta: { where: { contaId: input.contaId }, select: { status: true } } } },
      },
      orderBy: [{ nome: 'asc' }, { id: 'asc' }], skip, take: input.limit + 1,
    });
    const pending = await findPendingInvites(input.contaId, rows.map((row) => ({ id: row.id, email: row.email })));
    return {
      items: rows.slice(0, input.limit).map((row) => candidateItem({
        recordType: input.recordType,
        recordId: row.id,
        name: row.nome,
        email: row.email?.trim() ? row.email.trim().toLowerCase() : null,
        students: [],
        userStatus: row.usuario?.status,
        membershipStatus: row.usuario?.acessosConta[0]?.status,
        pending,
      })),
      hasMore: rows.length > input.limit,
    };
  }

  const rows = await prisma.responsavel.findMany({
    where: { contaId: input.contaId, alunos: { some: { contaId: input.contaId } }, ...whereSearch },
    select: {
      id: true,
      nome: true,
      email: true,
      usuario: { select: { status: true, acessosConta: { where: { contaId: input.contaId }, select: { status: true } } } },
      alunos: {
        where: { contaId: input.contaId },
        select: { alunoId: true, aluno: { select: { id: true, nome: true, contaId: true } } },
        orderBy: { alunoId: 'asc' },
      },
    },
    orderBy: [{ nome: 'asc' }, { id: 'asc' }], skip, take: input.limit + 1,
  });
  const pending = await findPendingInvites(input.contaId, rows.map((row) => ({ id: row.id, email: row.email })));
  return {
    items: rows.slice(0, input.limit).map((row) => candidateItem({
      recordType: input.recordType,
      recordId: row.id,
      name: row.nome,
      email: row.email.trim() ? row.email.trim().toLowerCase() : null,
      students: row.alunos.filter((link) => link.aluno.contaId === input.contaId)
        .map((link) => ({ id: link.aluno.id, name: link.aluno.nome })),
      userStatus: row.usuario?.status,
      membershipStatus: row.usuario?.acessosConta[0]?.status,
      pending,
    })),
    hasMore: rows.length > input.limit,
  };
}

async function findPendingInvites(contaId: string, targets: Array<{ id: string; email: string | null }>): Promise<PendingInviteTargets> {
  if (!targets.length) return { emails: new Set(), recordIds: new Set() };
  const emails = [...new Set(targets.map(({ email }) => email?.trim().toLowerCase()).filter((email): email is string => Boolean(email)))];
  const or: object[] = [
    ...emails.map((email) => ({ email: { equals: email, mode: 'insensitive' as const } })),
    ...targets.map(({ id }) => ({ metadata: { path: ['target', 'recordId'], equals: id } })),
  ];
  const rows = await prisma.invite.findMany({
    where: { contaId, status: 'PENDING', expiresAt: { gt: new Date() }, OR: or },
    select: { email: true, metadata: true },
  });
  const recordIds = new Set<string>();
  for (const row of rows) {
    if (!row.metadata || typeof row.metadata !== 'object' || Array.isArray(row.metadata)) continue;
    const target = (row.metadata as { target?: unknown }).target;
    if (target && typeof target === 'object' && !Array.isArray(target)) {
      const recordId = (target as { recordId?: unknown }).recordId;
      if (typeof recordId === 'string') recordIds.add(recordId);
    }
  }
  return {
    emails: new Set(rows.map((row) => row.email?.trim().toLowerCase()).filter((email): email is string => Boolean(email))),
    recordIds,
  };
}

function candidateItem(input: {
  recordType: InviteRecordTypeDTO;
  recordId: string;
  name: string;
  email: string | null;
  students: Array<{ id: string; name: string }>;
  userStatus?: string | null;
  membershipStatus?: string;
  pending: PendingInviteTargets;
}) {
  const accessStatus = accessState({ userStatus: input.userStatus, membershipStatus: input.membershipStatus });
  const invitePending = input.pending.recordIds.has(input.recordId) || Boolean(input.email && input.pending.emails.has(input.email));
  const emailUsable = input.recordType === 'RESPONSAVEL' || Boolean(input.email);
  return {
    kind: 'EXISTING_RECORD' as const,
    recordType: input.recordType,
    recordId: input.recordId,
    name: input.name,
    email: input.email,
    students: input.students,
    accessStatus,
    inviteStatus: invitePending ? 'PENDING' as const : 'NONE' as const,
    canInvite: emailUsable && canInvite({ accessStatus, userStatus: input.userStatus, invitePending }),
  };
}

export async function findLegacyResponsibleTargetFromStudents(contaId: string, studentIds: string[]) {
  const uniqueIds = [...new Set(studentIds)];
  const [students, links] = await Promise.all([
    prisma.aluno.findMany({ where: { contaId, id: { in: uniqueIds } }, select: { id: true } }),
    prisma.alunoResponsavel.findMany({
      where: { contaId, alunoId: { in: uniqueIds }, responsavel: { contaId } },
      select: { alunoId: true, responsavelId: true },
      orderBy: [{ responsavelId: 'asc' }, { alunoId: 'asc' }],
    }),
  ]);
  if (students.length !== uniqueIds.length || links.length < uniqueIds.length) return null;
  const responsibleIds = new Set(links.map((link) => link.responsavelId));
  if (responsibleIds.size !== 1 || uniqueIds.some((id) => !links.some((link) => link.alunoId === id))) return null;
  const recordId = [...responsibleIds][0];
  const target = await findInviteTargetInConta(contaId, { recordType: 'RESPONSAVEL', recordId });
  if (!target || uniqueIds.some((id) => !target.alunosIds.includes(id))) return null;
  return target;
}
