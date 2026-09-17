import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { apiErrorResponse } from '@/lib/api/report-api-error';
import {
  financeiroLancamentoCategoriaInputDTOSchema,
  financeiroLancamentoCategoriaMutationResultDTOSchema,
  financeiroLancamentoCategoriaQueryDTOSchema,
  listFinanceiroLancamentoCategoriasResultDTOSchema,
} from '@/features/financeiro/dtos';
import {
  mapFinanceiroLancamentoCategoriaToDTO,
  mapListFinanceiroLancamentoCategoriasResultToDTO,
} from '@/features/financeiro/mappers';
import { createLancamentoCategoria, listLancamentoCategorias } from '@/src/server/finance/lancamento-categoria.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function err(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(req: NextRequest) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return err(401, 'NAO_AUTENTICADO', 'Usuario nao autenticado');
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) return err(403, 'SEM_PERMISSAO', 'Acesso negado');

    const url = new URL(req.url);
    const parsedQuery = financeiroLancamentoCategoriaQueryDTOSchema.safeParse({
      tipo: url.searchParams.get('tipo') || undefined,
    });
    if (!parsedQuery.success) {
      const issue = parsedQuery.error.issues[0];
      return err(400, 'DADOS_INVALIDOS', issue.message);
    }
    const { tipo } = parsedQuery.data;

    const categorias = await listLancamentoCategorias({ contaId: auth.contaId, tipo });

    return NextResponse.json(
      listFinanceiroLancamentoCategoriasResultDTOSchema.parse(
        mapListFinanceiroLancamentoCategoriasResultToDTO({
          data: categorias.map((categoria) =>
            mapFinanceiroLancamentoCategoriaToDTO(
              categoria as unknown as Record<string, unknown>,
            ),
          ),
        }),
      ),
    );
  } catch (e) {
    return apiErrorResponse(e, {
      route: 'GET /api/financeiro/lancamentos/categorias',
      fallbackMessage: 'Não foi possível carregar as categorias.',
    });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return err(401, 'NAO_AUTENTICADO', 'Usuario nao autenticado');
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) return err(403, 'SEM_PERMISSAO', 'Acesso negado');

    const parsed = financeiroLancamentoCategoriaInputDTOSchema.safeParse(await req.json());
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return err(400, 'DADOS_INVALIDOS', issue.message);
    }
    const body = parsed.data;

    const result = await createLancamentoCategoria({ contaId: auth.contaId, ...body });
    if (result.kind === 'INVALID_PARENT') return err(400, 'DADOS_INVALIDOS', 'Subcategoria precisa referenciar uma categoria valida');
    if (result.kind === 'DUPLICATE') return err(409, 'JA_EXISTE', 'Categoria ja existe');
    const created = result.value;
    return NextResponse.json(
      financeiroLancamentoCategoriaMutationResultDTOSchema.parse({
        data: mapFinanceiroLancamentoCategoriaToDTO(
          created as unknown as Record<string, unknown>,
        ),
      }),
      { status: 201 },
    );
  } catch (e) {
    return apiErrorResponse(e, {
      route: 'POST /api/financeiro/lancamentos/categorias',
      fallbackMessage: 'Não foi possível criar a categoria.',
    });
  }
}
