import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/prisma/client';
import { getSessionUser } from '@/lib/auth/session';
import {
  listAlunosComContratosQueryDTOSchema,
  listAlunosComContratosResultDTOSchema,
} from '@/features/contratos/dtos';
import { mapAlunoContratoCardToDTO } from '@/features/contratos/mappers';

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: { message: 'Não autorizado' } }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);

  const parsed = listAlunosComContratosQueryDTOSchema.safeParse({
    q: searchParams.get('q') ?? undefined,
    status: searchParams.get('status') ?? undefined,
    turmaId: searchParams.get('turmaId') ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: parsed.error.issues[0]?.message ?? 'Parâmetros inválidos' } },
      { status: 400 },
    );
  }

  const { q, status, turmaId } = parsed.data;
  const qTerm = q?.toLowerCase() ?? '';
  const qDigits = (q ?? '').replace(/\D/g, '');

  try {
    const alunos = await prisma.aluno.findMany({
      where: {
        contaId: user.contaId,
        ...(qTerm || qDigits
          ? {
              OR: [
                { nome: { contains: qTerm, mode: 'insensitive' } },
                { nomeSocial: { contains: qTerm, mode: 'insensitive' } },
                { email: { contains: qTerm, mode: 'insensitive' } },
                ...(qDigits
                  ? [{ cpf: { contains: qDigits } }]
                  : []),
              ],
            }
          : {}),
        matriculas: {
          some: {
            ...(turmaId ? { turmaId } : {}),
            contratos: {
              some: {
                ...(status ? { status } : {}),
              },
            },
          },
        },
      },
      select: {
        id: true,
        nome: true,
        foto: true,
      },
      orderBy: { nome: 'asc' },
    });

    return NextResponse.json(
      listAlunosComContratosResultDTOSchema.parse(alunos.map((aluno) => mapAlunoContratoCardToDTO(aluno))),
    );
  } catch (error) {
    console.error('[CONTRATOS_ALUNOS_GET]', error);
    return NextResponse.json(
      { error: { message: 'Erro ao listar alunos com contratos' } },
      { status: 500 },
    );
  }
}
