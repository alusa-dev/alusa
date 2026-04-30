import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';

export type PortalSessionUser = {
  id: string;
  contaId: string;
  role: 'ALUNO' | 'RESPONSAVEL';
};

function json(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: { 'cache-control': 'no-store' } });
}

export async function requirePortalUser(requiredRole?: PortalSessionUser['role']) {
  const session = await getServerSession(authOptions);
  const user = session?.user as { id?: string; role?: string; contaId?: string } | undefined;

  if (!user?.id || !user?.contaId) {
    return { response: json(401, 'Não autenticado') } as const;
  }

  if (user.role !== 'ALUNO' && user.role !== 'RESPONSAVEL') {
    return { response: json(403, 'Acesso negado') } as const;
  }

  if (requiredRole && user.role !== requiredRole) {
    return { response: json(403, 'Acesso negado') } as const;
  }

  return {
    user: {
      id: user.id,
      contaId: user.contaId,
      role: user.role,
    } satisfies PortalSessionUser,
  } as const;
}

export async function resolvePortalAlunoIds(user: PortalSessionUser) {
  if (user.role === 'ALUNO') {
    const aluno = await prisma.aluno.findFirst({
      where: {
        usuario: { id: user.id },
        contaId: user.contaId,
      },
      select: { id: true },
    });
    return aluno ? [aluno.id] : [];
  }

  const responsavel = await prisma.responsavel.findFirst({
    where: {
      usuarioId: user.id,
      contaId: user.contaId,
    },
    select: {
      alunos: {
        select: { alunoId: true },
      },
    },
  });

  return responsavel?.alunos.map((item) => item.alunoId) ?? [];
}

export async function resolvePortalScopedAlunoIds(
  user: PortalSessionUser,
  requestedAlunoId?: string | null,
): Promise<{ alunoIds: string[] } | { response: NextResponse }> {
  const alunoIds = await resolvePortalAlunoIds(user);

  if (!requestedAlunoId) {
    return { alunoIds };
  }

  if (!alunoIds.includes(requestedAlunoId)) {
    return { response: json(403, 'Acesso negado a este aluno') };
  }

  return { alunoIds: [requestedAlunoId] };
}

export function calculatePortalAge(dataNasc: Date | null | undefined) {
  if (!dataNasc) return null;
  const hoje = new Date();
  const nascimento = new Date(dataNasc);
  let idade = hoje.getFullYear() - nascimento.getFullYear();
  const mes = hoje.getMonth() - nascimento.getMonth();
  if (mes < 0 || (mes === 0 && hoje.getDate() < nascimento.getDate())) {
    idade -= 1;
  }
  return idade;
}
