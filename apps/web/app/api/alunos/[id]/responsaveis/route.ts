import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import {
  linkAlunoResponsavelInputDTOSchema,
  linkAlunoResponsavelResultDTOSchema,
} from '@/features/responsaveis/dtos';
import {
  vincularResponsavelAoAluno,
  VinculoAlunoResponsavelError,
} from '@/src/server/alunos/aluno-responsavel.service';

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
    const ctxParams = await ctx.params;
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: { message: 'Não autorizado' } }, { status: 401 });
  }

  const alunoId = ctxParams.id?.trim();
  if (!alunoId) {
    return NextResponse.json({ error: { message: 'alunoId é obrigatório' } }, { status: 400 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = linkAlunoResponsavelInputDTOSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: parsed.error.issues[0]?.message ?? 'Payload inválido' } },
      { status: 400 },
    );
  }

  try {
    const result = await vincularResponsavelAoAluno({
      contaId: user.contaId,
      alunoId,
      responsavelId: parsed.data.responsavelId,
      tipoVinculo: parsed.data.tipoVinculo,
    });

    const dto = linkAlunoResponsavelResultDTOSchema.parse({
      vinculo: result.vinculo,
      created: result.created,
    });

    return NextResponse.json(
      dto,
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    if (error instanceof VinculoAlunoResponsavelError) {
      const status =
        error.code === 'ALUNO_NOT_FOUND' || error.code === 'RESPONSAVEL_NOT_FOUND'
          ? 404
          : 400;
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
    }

    console.error('[ALUNO_RESPONSAVEL_VINCULO]', error);
    return NextResponse.json(
      { error: { message: 'Erro ao vincular responsável' } },
      { status: 500 },
    );
  }
}
