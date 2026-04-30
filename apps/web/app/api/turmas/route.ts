import { NextResponse } from 'next/server';
import { createTurma, listTurmas, turmaSchema } from '@alusa/lib';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Novo formato de erro padronizado: { error: CODE, detail, issues? }
function apiError(status: number, code: string, detail: string, issues?: unknown) {
  return NextResponse.json(
    { error: code, detail, issues },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const contaIdFromQuery = url.searchParams.get('contaId')?.trim() || null;
    const session = await getServerSession(authOptions).catch(() => null);
    const sessionContaId =
      (session as { user?: { contaId?: string } } | null)?.user?.contaId?.trim() || null;
    const contaId = contaIdFromQuery ?? sessionContaId;
    if (!contaId) {
      return apiError(400, 'CONTA_OBRIGATORIA', 'contaId é obrigatório');
    }
    if (sessionContaId && contaId !== sessionContaId) {
      return apiError(
        403,
        'CONTA_INVALIDA',
        'A conta informada não pertence ao usuário autenticado.',
      );
    }
    const page = Number(url.searchParams.get('page') || '1');
    const pageSize = Number(url.searchParams.get('pageSize') || '20');
    const q = url.searchParams.get('q') || undefined;
    const status = url.searchParams.get('status') || undefined;
    const result = await listTurmas(contaId, { page, pageSize, q, status });
    return NextResponse.json(
      {
        data: result.data,
        meta: { page: result.page, pageSize: result.pageSize, total: result.total },
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e: unknown) {
    return apiError(500, 'ERRO_LISTAR_TURMAS', (e as Error).message);
  }
}

export async function POST(req: Request) {
  try {
    const json = await req.json();
    console.log('[API /turmas] Payload recebido:', JSON.stringify(json, null, 2));

    const parsed = turmaSchema.safeParse(json);
    if (!parsed.success) {
      console.error('[API /turmas] Erro de validação schema:', parsed.error.flatten());
      // Normaliza issues: array de { path, message }
      const issues = parsed.error.issues.map((i) => ({ path: i.path, message: i.message }));
      return apiError(422, 'VALIDACAO', 'Falha de validação', issues);
    }
    const contaIdFromBody = typeof json.contaId === 'string' ? json.contaId.trim() : null;
    const session = await getServerSession(authOptions).catch(() => null);
    const sessionContaId =
      (session as { user?: { contaId?: string } } | null)?.user?.contaId?.trim() || null;
    const contaId = contaIdFromBody ?? sessionContaId;
    if (!contaId) {
      console.error('[API /turmas] Faltou contaId (payload e sessão)');
      return apiError(400, 'CONTA_OBRIGATORIA', 'contaId é obrigatório');
    }
    if (sessionContaId && contaId !== sessionContaId) {
      return apiError(
        403,
        'CONTA_INVALIDA',
        'A conta informada não pertence ao usuário autenticado.',
      );
    }

    console.log('[API /turmas] Dados validados, tentando criar turma...');
    try {
      const turma = await createTurma({ ...parsed.data, contaId });
      console.log('[API /turmas] Turma criada com sucesso:', turma.id);
      return NextResponse.json({ data: turma }, { status: 201 });
    } catch (err: unknown) {
      const msg = (err as Error).message || 'Erro desconhecido';
      let code = 'ERRO_CRIAR_TURMA';
      let status = 422;
      if (/Conflito de horário/i.test(msg)) code = 'CONFLITO_HORARIO_SALA';
      else if (/Modalidade não encontrada/i.test(msg)) code = 'MODALIDADE_FORA_CONTA';
      else if (/Sala não encontrada/i.test(msg)) code = 'SALA_FORA_CONTA';
      else if (
        /Professor\(es\) inválido/i.test(msg) ||
        /Professor pertence a outra conta/i.test(msg)
      )
        code = 'PROFESSOR_INVALIDO_OU_FORA_CONTA';
      else if (/dados incompletos/i.test(msg)) code = 'PROFESSOR_INVALIDO_OU_FORA_CONTA';
      else if (/Hora início deve ser antes|Hora de início deve ser antes/i.test(msg))
        code = 'HORARIO_INVALIDO';
      else if (/Idade mínima não pode ser maior/i.test(msg)) code = 'IDADE_INVALIDA';
      else if (/Já existe uma turma/i.test(msg)) code = 'DUPLICIDADE_NOME';
      else status = 400; // Erro genérico inesperado
      // eslint-disable-next-line no-console
      console.error('[API /turmas] Falha ao criar turma:', { code, msg, raw: err });
      return apiError(status, code, msg);
    }
  } catch (e: unknown) {
    console.error('[API /turmas] Erro ao parsear JSON:', e);
    return apiError(400, 'REQUISICAO_INVALIDA', (e as Error).message);
  }
}
