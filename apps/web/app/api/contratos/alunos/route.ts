import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/prisma/client';
import { getSessionUser } from '@/lib/auth/session';
import {
  listAlunosComContratosQueryDTOSchema,
  listAlunosComContratosResultDTOSchema,
} from '@/features/contratos/dtos';
import { mapAlunoContratoCardToDTO } from '@/features/contratos/mappers';

const PAGE_SIZE = 7;

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

  const { q, status, turmaId, page: requestedPage } = parsed.data;
  const qTerm = q?.toLowerCase() ?? '';
  const qDigits = (q ?? '').replace(/\D/g, '');

  try {
    const where = {
      contaId: user.contaId,
      ...(qTerm || qDigits
        ? {
            OR: [
              { nome: { contains: qTerm, mode: 'insensitive' as const } },
              { nomeSocial: { contains: qTerm, mode: 'insensitive' as const } },
              { email: { contains: qTerm, mode: 'insensitive' as const } },
              ...(qDigits ? [{ cpf: { contains: qDigits } }] : []),
            ],
          }
        : {}),
      ...(turmaId
        ? {
            matriculas: {
              some: {
                turmaId,
                contratos: { some: { ...(status ? { status } : {}) } },
              },
            },
          }
        : {
            AND: [{
              OR: [
                { matriculas: { some: { contratos: { some: { ...(status ? { status } : {}) } } } } },
                { contratosEvento: { some: { ...(status ? { status } : {}) } } },
              ],
            }],
          }),
    };
    const total = await prisma.aluno.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(requestedPage, totalPages);
    const alunos = await prisma.aluno.findMany({
      where,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        nome: true,
        foto: true,
      },
      orderBy: { nome: 'asc' },
    });

    return NextResponse.json(
      listAlunosComContratosResultDTOSchema.parse({
        data: alunos.map((aluno) => mapAlunoContratoCardToDTO(aluno)),
        pagination: {
          page,
          pageSize: PAGE_SIZE,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      }),
    );
  } catch (error) {
    console.error('[CONTRATOS_ALUNOS_GET]', error);
    return NextResponse.json(
      { error: { message: 'Erro ao listar alunos com contratos' } },
      { status: 500 },
    );
  }
}
