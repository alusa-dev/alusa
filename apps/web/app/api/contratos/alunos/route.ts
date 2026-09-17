import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import {
  listAlunosComContratosQueryDTOSchema,
  listAlunosComContratosResultDTOSchema,
} from '@/features/contratos/dtos';
import { mapAlunoContratoCardToDTO } from '@/features/contratos/mappers';
import { listStudentsWithContracts } from '@/src/server/contracts/contract-read.service';

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
  try {
    const result = await listStudentsWithContracts({
      contaId: user.contaId,
      query: q,
      status,
      turmaId,
      page: requestedPage,
      pageSize: PAGE_SIZE,
    });

    return NextResponse.json(
      listAlunosComContratosResultDTOSchema.parse({
        data: result.alunos.map((aluno) => mapAlunoContratoCardToDTO(aluno)),
        pagination: {
          page: result.page,
          pageSize: PAGE_SIZE,
          total: result.total,
          totalPages: result.totalPages,
          hasNextPage: result.page < result.totalPages,
          hasPreviousPage: result.page > 1,
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
