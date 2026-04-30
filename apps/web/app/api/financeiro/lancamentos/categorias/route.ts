import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/prisma';
import { safeGetServerSession } from '@/lib/safe-server-session';
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

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type SessUser = { id?: string; contaId?: string; role?: string };
const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function err(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(req: NextRequest) {
  try {
    const session = await safeGetServerSession();
    const user = (session as { user?: SessUser } | null)?.user;
    if (!user?.id || !user?.contaId) return err(401, 'NAO_AUTENTICADO', 'Usuario nao autenticado');
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return err(403, 'SEM_PERMISSAO', 'Acesso negado');

    const url = new URL(req.url);
    const parsedQuery = financeiroLancamentoCategoriaQueryDTOSchema.safeParse({
      tipo: url.searchParams.get('tipo') || undefined,
    });
    if (!parsedQuery.success) {
      const issue = parsedQuery.error.issues[0];
      return err(400, 'DADOS_INVALIDOS', issue.message);
    }
    const { tipo } = parsedQuery.data;

    const categorias = await prisma.categoriaLancamento.findMany({
      where: { contaId: user.contaId, ...(tipo ? { tipo } : {}) },
      orderBy: [{ parentId: 'asc' }, { nome: 'asc' }],
    });

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
    console.error('[API lancamento categorias][GET]', e);
    return err(500, 'ERRO_INTERNO', (e as Error).message);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await safeGetServerSession();
    const user = (session as { user?: SessUser } | null)?.user;
    if (!user?.id || !user?.contaId) return err(401, 'NAO_AUTENTICADO', 'Usuario nao autenticado');
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return err(403, 'SEM_PERMISSAO', 'Acesso negado');

    const parsed = financeiroLancamentoCategoriaInputDTOSchema.safeParse(await req.json());
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return err(400, 'DADOS_INVALIDOS', issue.message);
    }
    const body = parsed.data;

    if (body.parentId) {
      const parent = await prisma.categoriaLancamento.findFirst({
        where: { id: body.parentId, contaId: user.contaId, tipo: body.tipo },
      });
      if (!parent) return err(400, 'DADOS_INVALIDOS', 'Subcategoria precisa referenciar uma categoria valida');
    }

    const existing = await prisma.categoriaLancamento.findFirst({
      where: { contaId: user.contaId, tipo: body.tipo, nome: body.nome.trim(), parentId: body.parentId ?? null },
    });
    if (existing) return err(409, 'JA_EXISTE', 'Categoria ja existe');

    const created = await prisma.categoriaLancamento.create({
      data: {
        contaId: user.contaId,
        nome: body.nome.trim(),
        tipo: body.tipo,
        parentId: body.parentId ?? null,
      },
    });
    return NextResponse.json(
      financeiroLancamentoCategoriaMutationResultDTOSchema.parse({
        data: mapFinanceiroLancamentoCategoriaToDTO(
          created as unknown as Record<string, unknown>,
        ),
      }),
      { status: 201 },
    );
  } catch (e) {
    console.error('[API lancamento categorias][POST]', e);
    return err(500, 'ERRO_INTERNO', (e as Error).message);
  }
}
