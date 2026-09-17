import { StatusMatricula } from '@prisma/client';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { apiJsonError } from '@/lib/api/standard-response';
import {
  listMatriculasQueryDTOSchema,
} from '@/features/cadastro/matriculas/dtos';
import { mapListMatriculasResultToDTO } from '@/features/cadastro/matriculas/mappers';
import { listarMatriculas } from './matricula.service';

const statusValues = new Set(Object.values(StatusMatricula));
const allowedRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);

function errorResult(status: number, code: string, message: string, details?: unknown) {
  return { kind: 'HTTP_ERROR' as const, response: apiJsonError(status, code, message, details) };
}

function normalizeMatriculaStatusFilters(values: string[]): StatusMatricula[] {
  return values.flatMap((value) => {
    if (value === 'CONCLUIDA') return [StatusMatricula.ENCERRADA];
    return statusValues.has(value as StatusMatricula) ? [value as StatusMatricula] : [];
  });
}

export async function listMatriculasHttp(req: Request) {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.getAll('status').flatMap((value) => value.split(',').map((item) => item.trim()).filter(Boolean));
    const excludeStatus = url.searchParams.getAll('excludeStatus').flatMap((value) => value.split(',').map((item) => item.trim()).filter(Boolean));
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '20');
    const comboParam = url.searchParams.get('comboId');

    const parsedQuery = listMatriculasQueryDTOSchema.safeParse({
      contaId: url.searchParams.get('contaId') ?? undefined,
      alunoId: url.searchParams.get('alunoId') ?? undefined,
      planoId: url.searchParams.get('planoId') ?? undefined,
      turmaId: url.searchParams.get('turmaId') ?? undefined,
      comboId: comboParam === 'null' ? null : comboParam === null ? undefined : comboParam.trim() || undefined,
      status,
      excludeStatus,
      q: url.searchParams.get('q') ?? undefined,
      search: url.searchParams.get('search') ?? undefined,
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 20,
    });
    if (!parsedQuery.success) {
      return errorResult(400, 'PARAMETROS_INVALIDOS', parsedQuery.error.issues[0]?.message ?? 'Parâmetros inválidos.', parsedQuery.error.issues);
    }

    const auth = await resolveTenantSession(parsedQuery.data.contaId ?? null);
    if (!auth.ok) {
      return auth.reason === 'CONTA_MISMATCH'
        ? errorResult(403, 'CONTA_INVALIDA', 'Conta informada não pertence ao usuário.')
        : errorResult(403, 'CONTA_SESSAO_OBRIGATORIA', 'A conta ativa precisa estar vinculada à sessão do usuário.');
    }
    if (!auth.contaId) return errorResult(400, 'CONTA_OBRIGATORIA', 'contaId é obrigatório');
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) {
      return errorResult(403, 'PERMISSAO_NEGADA', 'Usuário não tem permissão para acessar matrículas.');
    }

    const result = await listarMatriculas({
      contaId: auth.contaId,
      alunoId: parsedQuery.data.alunoId ?? undefined,
      planoId: parsedQuery.data.planoId ?? undefined,
      turmaId: parsedQuery.data.turmaId ?? undefined,
      comboId: parsedQuery.data.comboId === undefined ? undefined : parsedQuery.data.comboId,
      status: normalizeMatriculaStatusFilters(parsedQuery.data.status).length > 0
        ? normalizeMatriculaStatusFilters(parsedQuery.data.status)
        : undefined,
      excludeStatus: normalizeMatriculaStatusFilters(parsedQuery.data.excludeStatus).length > 0
        ? normalizeMatriculaStatusFilters(parsedQuery.data.excludeStatus)
        : undefined,
      search: parsedQuery.data.q ?? parsedQuery.data.search ?? undefined,
      page: parsedQuery.data.page,
      pageSize: parsedQuery.data.pageSize,
    });
    return { kind: 'OK' as const, data: mapListMatriculasResultToDTO(result) };
  } catch (error) {
    console.error('Erro ao listar matrículas:', error);
    return errorResult(500, 'ERRO_LISTAR_MATRICULAS', 'Não foi possível listar as matrículas.');
  }
}
