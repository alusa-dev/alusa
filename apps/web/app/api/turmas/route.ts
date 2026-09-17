import { NextResponse } from 'next/server';
import { turmaSchema } from '@alusa/lib/schemas/turma.schema';
import { createTurma, listTurmas } from '@alusa/lib/services/turma.service';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { assertPlatformAccessForConta } from '@/src/server/platform-billing/capacity';
import { apiErrorResponse } from '@/lib/api/report-api-error';

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
    const tenant = await resolveTenantSession(url.searchParams.get('contaId'));
    if (!tenant.ok) {
      return apiError(
        tenant.reason === 'UNAUTHENTICATED' ? 401 : 403,
        tenant.reason === 'UNAUTHENTICATED' ? 'NAO_AUTENTICADO' : 'CONTA_INVALIDA',
        tenant.reason === 'UNAUTHENTICATED'
          ? 'Usuário não autenticado.'
          : 'A conta informada não pertence ao usuário autenticado.',
      );
    }
    const contaId = tenant.contaId;
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
    return apiErrorResponse(e, {
      route: 'GET /api/turmas',
      fallbackMessage: 'Não foi possível carregar as turmas.',
    });
  }
}

export async function POST(req: Request) {
  try {
    const json = await req.json();
    console.log('[API /turmas] Payload recebido:', JSON.stringify(json, null, 2));

    const tenant = await resolveTenantSession(
      typeof json?.contaId === 'string' ? json.contaId : null,
    );
    if (!tenant.ok) {
      return apiError(
        tenant.reason === 'UNAUTHENTICATED' ? 401 : 403,
        tenant.reason === 'UNAUTHENTICATED' ? 'NAO_AUTENTICADO' : 'CONTA_INVALIDA',
        tenant.reason === 'UNAUTHENTICATED'
          ? 'Usuário não autenticado.'
          : 'A conta informada não pertence ao usuário autenticado.',
      );
    }
    const contaId = tenant.contaId;
    const parsed = turmaSchema.safeParse({ ...json, contaId });
    if (!parsed.success) {
      console.error('[API /turmas] Erro de validação schema:', parsed.error.flatten());
      // Normaliza issues: array de { path, message }
      const issues = parsed.error.issues.map((i) => ({ path: i.path, message: i.message }));
      return apiError(422, 'VALIDACAO', 'Falha de validação', issues);
    }
    await assertPlatformAccessForConta({ contaId, capability: 'CLASS_WRITE' });

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
      console.error('[API /turmas] Falha ao criar turma:', { code, msg, raw: err });
      return apiError(status, code, msg);
    }
  } catch (e: unknown) {
    console.error('[API /turmas] Erro ao parsear JSON:', e);
    return apiError(400, 'REQUISICAO_INVALIDA', (e as Error).message);
  }
}
