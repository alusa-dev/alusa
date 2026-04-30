import { safeGetServerSession } from '@/lib/safe-server-session';
import { prisma } from '@/src/prisma';

export type AulasSessionUser = {
  id: string;
  contaId: string;
  role: string;
  email: string | null;
};

export type AulasAccessScope = {
  contaId: string;
  userId: string;
  role: string;
  isProfessor: boolean;
  professorId: string | null;
  professorLabel: string | null;
};

export const AULAS_ALLOWED_ROLES = new Set(['ADMIN', 'RECEPCAO', 'PROFESSOR']);

export async function getAulasSessionUser(): Promise<AulasSessionUser | null> {
  const session = await safeGetServerSession();
  const user = (session as {
    user?: { id?: string; contaId?: string; role?: string; email?: string | null };
  } | null)?.user;

  if (!user?.id || !user?.contaId || !user?.role) {
    return null;
  }

  return {
    id: String(user.id),
    contaId: String(user.contaId),
    role: String(user.role).toUpperCase(),
    email: user.email ? String(user.email) : null,
  };
}

export function canAccessAulas(user: Pick<AulasSessionUser, 'role'> | null): boolean {
  return Boolean(user?.role && AULAS_ALLOWED_ROLES.has(user.role.toUpperCase()));
}

export async function resolveAulasAccessScope(user: AulasSessionUser): Promise<AulasAccessScope> {
  if (user.role !== 'PROFESSOR') {
    return {
      contaId: user.contaId,
      userId: user.id,
      role: user.role,
      isProfessor: false,
      professorId: null,
      professorLabel: null,
    };
  }

  const professor = user.email
    ? await prisma.professor.findFirst({
        where: {
          contaId: user.contaId,
          status: 'ATIVO',
          email: { equals: user.email, mode: 'insensitive' },
        },
        select: { id: true, nome: true },
      })
    : null;

  return {
    contaId: user.contaId,
    userId: user.id,
    role: user.role,
    isProfessor: true,
    professorId: professor?.id ?? null,
    professorLabel: professor?.nome ?? user.email,
  };
}
